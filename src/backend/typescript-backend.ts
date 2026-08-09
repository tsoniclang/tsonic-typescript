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
import {
  prepareTypeScriptLowering,
} from "../lowering/transform.js";
import type { TypeScriptAstPrinter } from "../print/ast-printer.js";
import { createTypeScriptProjectArtifact } from "./project-artifact.js";
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
        if (compiled.diagnostics.length > 0) {
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
): {
  readonly artifacts: readonly TargetArtifact[];
  readonly diagnostics: TargetCompileResult["diagnostics"];
  readonly usesRuntime: boolean;
} {
  const prepared = prepareSourceArtifacts(input, profile);
  if (prepared.diagnostics.length > 0) {
    return Object.freeze({
      artifacts: [],
      diagnostics: prepared.diagnostics,
      usesRuntime: false,
    });
  }
  const artifacts = printEncodedTypeScriptSources(
    prepared.artifacts,
    printer,
  );
  return Object.freeze({
    artifacts,
    diagnostics: [],
    usesRuntime: prepared.usesRuntime,
  });
}

function prepareSourceArtifacts(
  input: TargetCompileInput,
  profile: TypeScriptOptimizationProfile,
): {
  readonly artifacts: readonly EncodedTypeScriptSource[];
  readonly diagnostics: TargetCompileResult["diagnostics"];
  readonly usesRuntime: boolean;
} {
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
      artifacts: [],
      diagnostics: Object.freeze(diagnostics),
      usesRuntime: false,
    });
  }
  const preparation = prepareTypeScriptLowering(
    input.source,
    sourceFiles,
    profile,
  );
  if (preparation.kind === "rejected") {
    return Object.freeze({
      artifacts: [],
      diagnostics: Object.freeze(preparation.failures.map((failure) =>
        loweringDiagnostic(
          input.source.documents.forFile(failure.sourceFile).fileName,
          failure.message,
        )
      )),
      usesRuntime: false,
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
    artifacts: Object.freeze(artifacts),
    diagnostics: Object.freeze(diagnostics),
    usesRuntime,
  });
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
