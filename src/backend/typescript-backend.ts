import { isAbsolute, relative } from "node:path";

import type {
  TargetArtifact,
  TargetBackend,
  TargetCompileInput,
  TargetCompileResult,
} from "@tsonic/target-api";
import {
  encodeTargetSourceFileForPrinting,
  TargetAstEncodingError,
} from "@tsonic/tsts/target-ast";

import {
  canonicalTypeScriptOptimizationProfile,
  type TypeScriptOptimizationProfile,
} from "../lowering/profile.js";
import type { TypeScriptOptimizationEvidence } from "../lowering/evidence.js";
import {
  prepareTypeScriptLowering,
} from "../lowering/transform.js";
import type { TypeScriptAstPrinter } from "../print/ast-printer.js";
import { createTypeScriptProjectArtifact } from "./project-artifact.js";
import { createOptimizationEvidenceArtifact } from "./optimization-evidence-artifact.js";
import {
  printEncodedTypeScriptSources,
  type EncodedTypeScriptSource,
} from "./source-artifact-batches.js";
import { compareSourceDocumentIdentities } from "./source-order.js";

export function createTypeScriptBackend(
  printer: TypeScriptAstPrinter,
  profile: TypeScriptOptimizationProfile = canonicalTypeScriptOptimizationProfile(),
): TargetBackend {
  return {
    compile(input: TargetCompileInput): TargetCompileResult {
      try {
        const compiled = compileSourceArtifacts(input, printer, profile);
        if (compiled.kind === "rejected") {
          return {
            artifacts: [],
            diagnostics: compiled.diagnostics,
          };
        }
        return {
          artifacts: Object.freeze([
            createTypeScriptProjectArtifact(
              input.runtimeReferences,
              compiled.usesRuntime,
            ),
            createOptimizationEvidenceArtifact(compiled.evidence),
            ...compiled.artifacts,
          ]),
          diagnostics: [],
        };
      } catch (error) {
        return {
          artifacts: [],
          diagnostics: [{
            code: "TYPESCRIPT_TARGET_LOWERING",
            category: "error",
            source: "@tsonic/target-typescript",
            message: error instanceof Error ? error.message : String(error),
          }],
        };
      }
    },
  };
}

function compileSourceArtifacts(
  input: TargetCompileInput,
  printer: TypeScriptAstPrinter,
  profile: TypeScriptOptimizationProfile,
): CompiledSourceArtifacts {
  const prepared = prepareSourceArtifacts(input, profile);
  if (prepared.kind === "rejected") {
    return prepared;
  }
  const artifacts = printEncodedTypeScriptSources(
    prepared.artifacts,
    printer,
  );
  return Object.freeze({
    kind: "ready",
    artifacts,
    usesRuntime: prepared.usesRuntime,
    evidence: prepared.evidence,
  });
}

function prepareSourceArtifacts(
  input: TargetCompileInput,
  profile: TypeScriptOptimizationProfile,
): PreparedSourceArtifacts {
  const artifacts: EncodedTypeScriptSource[] = [];
  const diagnostics: TargetCompileResult["diagnostics"][number][] = [];
  let usesRuntime = false;
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
        document,
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
  for (const selected of selectedSources) {
    try {
      const lowered = preparation.transaction.lower(selected.sourceFile);
      artifacts.push(Object.freeze({
        path: selected.path,
        encoded: encodeTargetSourceFile(lowered.sourceFile),
      }));
      usesRuntime ||= lowered.pointer.runtimeAlias !== undefined;
    } catch (error) {
      diagnostics.push(loweringDiagnostic(selected.document.fileName, error));
    }
  }
  preparation.transaction.finish();
  return Object.freeze({
    kind: "ready",
    artifacts: Object.freeze(artifacts),
    usesRuntime,
    evidence: preparation.transaction.evidence,
  });
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
      readonly artifacts: readonly EncodedTypeScriptSource[];
      readonly usesRuntime: boolean;
      readonly evidence: TypeScriptOptimizationEvidence;
    };

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
