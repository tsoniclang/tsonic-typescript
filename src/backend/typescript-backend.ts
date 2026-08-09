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

import { lowerPointers } from "../lowering/pointer/transform.js";
import type { TypeScriptAstPrinter } from "../print/ast-printer.js";
import { createTypeScriptProjectArtifact } from "./project-artifact.js";
import {
  printEncodedTypeScriptSources,
  type EncodedTypeScriptSource,
} from "./source-artifact-batches.js";
import { compareSourceDocumentIdentities } from "./source-order.js";

export function createTypeScriptBackend(
  printer: TypeScriptAstPrinter,
): TargetBackend {
  return {
    compile(input: TargetCompileInput): TargetCompileResult {
      try {
        const compiled = compileSourceArtifacts(input, printer);
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
): {
  readonly artifacts: readonly TargetArtifact[];
  readonly diagnostics: TargetCompileResult["diagnostics"];
  readonly usesRuntime: boolean;
} {
  const prepared = prepareSourceArtifacts(input);
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

function prepareSourceArtifacts(input: TargetCompileInput): {
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
  for (const sourceFile of sourceFiles) {
    const document = input.source.documents.forFile(sourceFile);
    try {
      if (document.sourceFile !== sourceFile) {
        throw new Error(
          `source document '${document.identity}' does not own its exact AST`,
        );
      }
      const lowered = lowerPointers(input.source, sourceFile);
      artifacts.push(Object.freeze({
        path: sourceArtifactPath(input, document.fileName),
        encoded: encodeTargetSourceFile(lowered.sourceFile),
      }));
      usesRuntime ||= lowered.runtimeAlias !== undefined;
    } catch (error) {
      diagnostics.push({
        code: "TYPESCRIPT_TARGET_LOWERING",
        category: "error",
        source: "@tsonic/target-typescript",
        message: `${document.fileName}: ${error instanceof Error ? error.message : String(error)}`,
      });
    }
  }
  return Object.freeze({
    artifacts: Object.freeze(artifacts),
    diagnostics: Object.freeze(diagnostics),
    usesRuntime,
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
