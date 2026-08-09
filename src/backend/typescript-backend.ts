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
import {
  TypeScriptPrinterRequest,
  type TypeScriptAstPrinter,
} from "../print/ast-printer.js";
import { createTypeScriptProjectArtifact } from "./project-artifact.js";
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
  const artifacts: TargetSourceFile[] = [];
  let pending: {
    readonly path: string;
  }[] = [];
  let printerRequest = new TypeScriptPrinterRequest();
  let usesRuntime = false;
  const diagnostics: TargetCompileResult["diagnostics"][number][] = [];
  const sourceFiles = [...input.source.navigation.sourceFiles].sort(
    (left, right) => compareSourceDocumentIdentities(
      input.source.documents.forFile(left).identity,
      input.source.documents.forFile(right).identity,
    ),
  );
  for (const sourceFile of sourceFiles) {
    const document = input.source.documents.forFile(sourceFile);
    let encoded: Uint8Array;
    let fileUsesRuntime: boolean;
    try {
      if (document.sourceFile !== sourceFile) {
        throw new Error(
          `source document '${document.identity}' does not own its exact AST`,
        );
      }
      const result = lowerPointers(input.source, sourceFile);
      encoded = encodeTargetSourceFile(document.fileName, result.sourceFile);
      fileUsesRuntime = result.runtimeAlias !== undefined;
    } catch (error) {
      diagnostics.push({
        code: "TYPESCRIPT_TARGET_LOWERING",
        category: "error",
        source: "@tsonic/target-typescript",
        message: `${document.fileName}: ${error instanceof Error ? error.message : String(error)}`,
      });
      continue;
    }
    if (!printerRequest.tryAppend(encoded)) {
      artifacts.push(...printBatch(printer, printerRequest, pending));
      printerRequest = new TypeScriptPrinterRequest();
      pending = [];
      printerRequest.append(encoded);
    }
    pending.push({
      path: sourceArtifactPath(input, document.fileName),
    });
    usesRuntime ||= fileUsesRuntime;
  }
  if (diagnostics.length > 0) {
    return Object.freeze({
      artifacts: [],
      diagnostics: Object.freeze(diagnostics),
      usesRuntime: false,
    });
  }
  artifacts.push(...printBatch(printer, printerRequest, pending));
  return Object.freeze({
    artifacts: Object.freeze(artifacts),
    diagnostics: [],
    usesRuntime,
  });
}

function printBatch(
  printer: TypeScriptAstPrinter,
  request: TypeScriptPrinterRequest,
  pending: readonly { readonly path: string }[],
): readonly TargetSourceFile[] {
  if (request.size === 0) {
    return [];
  }
  const printed = printer.print(request);
  if (printed.length !== pending.length) {
    throw new Error(
      `TypeScript AST printer returned ${printed.length} files, expected ${pending.length}`,
    );
  }
  return Object.freeze(
    pending.map((artifact, index): TargetSourceFile => ({
      kind: "source",
      language: "typescript",
      path: artifact.path,
      text: requiredPrintedSource(printed, index),
    })),
  );
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
