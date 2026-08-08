import { isAbsolute, relative } from "node:path";

import type {
  TargetArtifact,
  TargetBackend,
  TargetCompileInput,
  TargetCompileResult,
  TargetSourceFile,
} from "@tsonic/target-api";
import {
  encodeTargetSourceFileForPrinting,
  TargetAstEncodingError,
} from "@tsonic/tsts/target-ast";

import { lowerPointers } from "../lowering/pointer/transform.js";
import type { TypeScriptAstPrinter } from "../print/ast-printer.js";
import { createTypeScriptProjectArtifact } from "./project-artifact.js";

export function createTypeScriptBackend(
  printer: TypeScriptAstPrinter,
): TargetBackend {
  return {
    compile(input: TargetCompileInput): TargetCompileResult {
      try {
        const compiled = compileSourceArtifacts(input, printer);
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
  readonly usesRuntime: boolean;
} {
  const lowered = input.source.navigation.sourceFiles.map((sourceFile) => {
    const document = input.source.documents.forFile(sourceFile);
    if (document.sourceFile !== sourceFile) {
      throw new Error(
        `source document '${document.identity}' does not own its exact AST`,
      );
    }
    const result = lowerPointers(input.source, sourceFile);
    return {
      path: sourceArtifactPath(input, document.fileName),
      encoded: encodeTargetSourceFile(document.fileName, result.sourceFile),
      usesRuntime: result.runtimeAlias !== undefined,
    };
  });
  const printed = printer.print(lowered.map((artifact) => artifact.encoded));
  if (printed.length !== lowered.length) {
    throw new Error(
      `TypeScript AST printer returned ${printed.length} files, expected ${lowered.length}`,
    );
  }
  return Object.freeze({
    artifacts: Object.freeze(lowered.map((artifact, index): TargetSourceFile => ({
      kind: "source",
      language: "typescript",
      path: artifact.path,
      text: requiredPrintedSource(printed, index),
    }))),
    usesRuntime: lowered.some((artifact) => artifact.usesRuntime),
  });
}

function encodeTargetSourceFile(
  fileName: string,
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
      `${fileName}: ${error.message}${evidence.length === 0 ? "" : ` (${evidence.join(", ")})`}`,
      { cause: error },
    );
  }
}

function requiredPrintedSource(
  printed: readonly string[],
  index: number,
): string {
  const source = printed[index];
  if (source === undefined) {
    throw new Error(`TypeScript AST printer omitted file ${index}`);
  }
  return source;
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
