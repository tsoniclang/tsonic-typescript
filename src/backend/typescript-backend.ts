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
  createPointerLoweringPlan,
  pointerLoweringPlanUsesRuntime,
  type PointerLoweringPlan,
} from "../lowering/pointer/plan.js";
import { applyPointerLoweringPlan } from "../lowering/pointer/transform.js";
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
  const planned = planSourceArtifacts(input);
  if (planned.diagnostics.length > 0) {
    return Object.freeze({
      artifacts: [],
      diagnostics: planned.diagnostics,
      usesRuntime: false,
    });
  }
  const artifacts = printEncodedTypeScriptSources(
    encodePlannedSourceArtifacts(input, planned.artifacts),
    printer,
  );
  return Object.freeze({
    artifacts,
    diagnostics: [],
    usesRuntime: planned.artifacts.some((artifact) =>
      pointerLoweringPlanUsesRuntime(artifact.plan)),
  });
}

interface PlannedSourceArtifact {
  readonly fileName: string;
  readonly path: string;
  readonly plan: PointerLoweringPlan;
}

function planSourceArtifacts(input: TargetCompileInput): {
  readonly artifacts: readonly PlannedSourceArtifact[];
  readonly diagnostics: TargetCompileResult["diagnostics"];
} {
  const artifacts: PlannedSourceArtifact[] = [];
  const diagnostics: TargetCompileResult["diagnostics"][number][] = [];
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
      artifacts.push(Object.freeze({
        fileName: document.fileName,
        path: sourceArtifactPath(input, document.fileName),
        plan: createPointerLoweringPlan(input.source, sourceFile),
      }));
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
  });
}

function* encodePlannedSourceArtifacts(
  input: TargetCompileInput,
  artifacts: readonly PlannedSourceArtifact[],
): Iterable<EncodedTypeScriptSource> {
  for (const artifact of artifacts) {
    try {
      const lowered = applyPointerLoweringPlan(input.source, artifact.plan);
      yield Object.freeze({
        path: artifact.path,
        encoded: encodeTargetSourceFile(lowered.sourceFile),
      });
    } catch (error) {
      throw new Error(
        `${artifact.fileName}: ${error instanceof Error ? error.message : String(error)}`,
        { cause: error },
      );
    }
  }
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
