import { isAbsolute, relative } from "node:path";

import type { TargetCompileInput } from "@tsonic/target-api";
import {
  rejectedTargetStage,
  resolvedTargetStage,
  type TargetArtifact,
  type TargetCompileResult,
} from "@tsonic/target-api/artifacts";
import {
  encodeTargetSourceFileForPrinting,
  TargetAstEncodingError,
} from "@tsonic/tsts/target-ast";
import type { SourceFile } from "@tsonic/tsts";

import {
  canonicalTypeScriptOptimizationProfile,
  createTypeScriptOptimizationProfile,
  type TypeScriptOptimizationProfileInput,
} from "../lowering/profile.js";
import type { TypeScriptOptimizationEvidence } from "../lowering/evidence.js";
import type {
  TypeScriptSourceExecutionProfile,
} from "../source-contract/execution.js";
import {
  canonicalRepresentationTransportContract,
  type RepresentationTransportContract,
} from "../lowering/representation/transport-contract.js";
import {
  prepareTypeScriptLowering,
  type TypeScriptLoweringTransaction,
} from "../lowering/transform.js";
import type { TypeScriptAstPrinter } from "../print/ast-printer.js";
import { createTypeScriptProjectArtifact } from "./project-artifact.js";
import { createOptimizationEvidenceArtifact } from "./optimization-evidence-artifact.js";
import {
  printEncodedTypeScriptSources,
  type EncodedTypeScriptSource,
} from "./source-artifact-batches.js";
import { compareSourceDocumentIdentities } from "./source-order.js";

export function compileTypeScriptTarget(
  input: TargetCompileInput,
  printer: TypeScriptAstPrinter,
  profileInput: TypeScriptOptimizationProfileInput = canonicalTypeScriptOptimizationProfile(),
  execution: TypeScriptSourceExecutionProfile = "unrestricted",
  representationTransports: RepresentationTransportContract =
    canonicalRepresentationTransportContract(),
): TargetCompileResult {
  const profile = createTypeScriptOptimizationProfile(profileInput);
  try {
    const compiled = compileSourceArtifacts(
      input,
      printer,
      profile,
      execution,
      representationTransports,
    );
    if (compiled.kind === "rejected") {
      return rejectedTargetStage(compiled.diagnostics);
    }
    return resolvedTargetStage(Object.freeze({
      artifacts: Object.freeze([
        createTypeScriptProjectArtifact(
          input.runtimeReferences,
          compiled.usesRuntime,
        ),
        createOptimizationEvidenceArtifact(compiled.evidence),
        ...compiled.artifacts,
      ]),
    }));
  } catch (error) {
    return rejectedTargetStage([Object.freeze({
      code: "TYPESCRIPT_TARGET_LOWERING",
      category: "error",
      source: "@tsonic/target-typescript",
      message: error instanceof Error ? error.message : String(error),
    })]);
  }
}

function compileSourceArtifacts(
  input: TargetCompileInput,
  printer: TypeScriptAstPrinter,
  profile: TypeScriptOptimizationProfileInput,
  execution: TypeScriptSourceExecutionProfile,
  representationTransports: RepresentationTransportContract,
): CompiledSourceArtifacts {
  const prepared = prepareSourceArtifacts(
    input,
    profile,
    execution,
    representationTransports,
  );
  if (prepared.kind === "rejected") {
    return prepared;
  }
  const publication: SourcePublicationState = {
    finished: false,
    usesRuntime: false,
  };
  const artifacts = printEncodedTypeScriptSources(
    encodePreparedSources(prepared, publication),
    printer,
  );
  if (!publication.finished) {
    throw new Error("TypeScript source publication did not consume every planned source");
  }
  return Object.freeze({
    kind: "ready",
    artifacts,
    usesRuntime: publication.usesRuntime,
    evidence: prepared.transaction.evidence,
  });
}

function prepareSourceArtifacts(
  input: TargetCompileInput,
  profile: TypeScriptOptimizationProfileInput,
  execution: TypeScriptSourceExecutionProfile,
  representationTransports: RepresentationTransportContract,
): PreparedSourceArtifacts {
  const diagnostics: TargetCompileResult["diagnostics"][number][] = [];
  const sourceFiles = [...input.source.navigation.sourceFiles].sort(
    (left, right) => compareSourceDocumentIdentities(
      input.source.documents.forFile(left).identity,
      input.source.documents.forFile(right).identity,
    ),
  );
  const selectedSources = sourceFiles.flatMap((sourceFile) => {
    const document = input.source.documents.forFile(sourceFile);
    try {
      if (document.sourceFile !== sourceFile) {
        throw new Error(
          `source document '${document.identity}' does not own its exact AST`,
        );
      }
      return [Object.freeze({
        sourceFile,
        fileName: document.fileName,
        path: sourceArtifactPath(input, document.fileName),
      })];
    } catch (error) {
      diagnostics.push(loweringDiagnostic(document.fileName, error));
      return [];
    }
  });
  if (diagnostics.length !== 0) {
    return Object.freeze({
      kind: "rejected",
      diagnostics: Object.freeze(diagnostics),
    });
  }
  const preparation = prepareTypeScriptLowering(
    input.source,
    sourceFiles,
    profile,
    (sourceFile) => sourceArtifactPath(
      input,
      input.source.documents.forFile(sourceFile).fileName,
    ),
    execution,
    representationTransports,
  );
  if (preparation.kind === "rejected") {
    return Object.freeze({
      kind: "rejected",
      diagnostics: Object.freeze(preparation.failures.map((failure) =>
        loweringDiagnostic(
          input.source.documents.forFile(failure.sourceFile).fileName,
          failure.message,
        )
      )),
    });
  }
  return Object.freeze({
    kind: "ready",
    sources: Object.freeze(selectedSources),
    transaction: preparation.transaction,
  });
}

function* encodePreparedSources(
  prepared: Extract<PreparedSourceArtifacts, { readonly kind: "ready" }>,
  publication: SourcePublicationState,
): Iterable<EncodedTypeScriptSource> {
  for (const selected of prepared.sources) {
    try {
      const lowered = prepared.transaction.lower(selected.sourceFile);
      publication.usesRuntime ||= lowered.pointer.runtimeAlias !== undefined;
      yield Object.freeze({
        path: selected.path,
        encoded: encodeTargetSourceFile(lowered.sourceFile),
      });
    } catch (error) {
      throw new Error(
        `${selected.fileName}: ${error instanceof Error ? error.message : String(error)}`,
        { cause: error },
      );
    }
  }
  prepared.transaction.finish();
  publication.finished = true;
}

type CompiledSourceArtifacts =
  | RejectedSourceArtifacts
  | {
      readonly kind: "ready";
      readonly artifacts: readonly TargetArtifact[];
      readonly usesRuntime: boolean;
      readonly evidence: TypeScriptOptimizationEvidence;
    };

type PreparedSourceArtifacts =
  | RejectedSourceArtifacts
  | {
      readonly kind: "ready";
      readonly sources: readonly PreparedTypeScriptSource[];
      readonly transaction: TypeScriptLoweringTransaction;
    };

interface PreparedTypeScriptSource {
  readonly sourceFile: SourceFile;
  readonly fileName: string;
  readonly path: string;
}

interface SourcePublicationState {
  finished: boolean;
  usesRuntime: boolean;
}

interface RejectedSourceArtifacts {
  readonly kind: "rejected";
  readonly diagnostics: TargetCompileResult["diagnostics"];
}

function loweringDiagnostic(
  fileName: string,
  error: unknown,
): TargetCompileResult["diagnostics"][number] {
  return Object.freeze({
    code: "TYPESCRIPT_TARGET_LOWERING",
    category: "error",
    source: "@tsonic/target-typescript",
    message: `${fileName}: ${error instanceof Error ? error.message : String(error)}`,
  });
}

function encodeTargetSourceFile(
  sourceFile: Parameters<typeof encodeTargetSourceFileForPrinting>[0],
): Uint8Array {
  try {
    return encodeTargetSourceFileForPrinting(sourceFile);
  } catch (error) {
    if (!(error instanceof TargetAstEncodingError)) {
      throw error;
    }
    const evidence = [
      error.kind === undefined ? undefined : `kind=${error.kind}`,
      error.field === undefined ? undefined : `field=${error.field}`,
    ].filter((value): value is string => value !== undefined);
    throw new Error(
      `${error.message}${evidence.length === 0 ? "" : ` (${evidence.join(", ")})`}`,
      { cause: error },
    );
  }
}

function sourceArtifactPath(input: TargetCompileInput, fileName: string): string {
  const path = relative(input.paths.projectRoot, fileName).split("\\").join("/");
  if (
    path.length === 0 ||
    path === "." ||
    path === ".." ||
    path.startsWith("../") ||
    isAbsolute(path)
  ) {
    throw new Error(
      `checked source '${fileName}' is outside project root '${input.paths.projectRoot}'`,
    );
  }
  return path;
}
