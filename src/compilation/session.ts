import type {
  TargetCompilationSession,
  TargetCompilationSessionContext,
  TargetCompileInput,
  TargetSourceCompilerContributions,
  TargetSourceProfileContributions,
} from "@tsonic/target-api";
import type {
  TargetCompileResult,
  TargetRuntimeContributions,
} from "@tsonic/target-api/artifacts";

import { compileTypeScriptTarget } from "../backend/typescript-backend.js";
import { readTypeScriptTargetOptions } from "../config/options.js";
import { createExternalAstPrinter } from "../print/ast-printer.js";
import { typeScriptRuntimeReference } from "../runtime/package-contract.js";

type TypeScriptCompilationSessionState =
  | "created"
  | "profile-contributed"
  | "compiler-contributed"
  | "runtime-contributed"
  | "compiled"
  | "closed";

export function createTypeScriptCompilationSession(
  context: TargetCompilationSessionContext,
): TargetCompilationSession {
  const options = readTypeScriptTargetOptions(context.target);
  const printer = createExternalAstPrinter(options.printer);
  let state: TypeScriptCompilationSessionState = "created";
  return Object.freeze({
    sourceProfileContributions(): TargetSourceProfileContributions {
      requireState(state, "created", "sourceProfileContributions");
      state = "profile-contributed";
      return Object.freeze({
        declarationPolicy: Object.freeze({
          bundledLibraries: Object.freeze(["lib.es2024.d.ts"]),
          installedDeclarations: "package-contract",
        }),
      });
    },
    sourceCompilerContributions(): TargetSourceCompilerContributions {
      requireState(state, "profile-contributed", "sourceCompilerContributions");
      state = "compiler-contributed";
      return Object.freeze({ extensions: Object.freeze([]) });
    },
    runtimeContributions(): TargetRuntimeContributions {
      requireState(state, "compiler-contributed", "runtimeContributions");
      state = "runtime-contributed";
      return Object.freeze({
        references: Object.freeze([typeScriptRuntimeReference()]),
      });
    },
    compile(input: TargetCompileInput): TargetCompileResult {
      requireState(state, "runtime-contributed", "compile");
      state = "compiled";
      return compileTypeScriptTarget(
        input,
        printer,
        options.optimizations,
        options.execution,
        options.representationTransports,
      );
    },
    close(): void {
      state = "closed";
    },
  });
}

function requireState(
  actual: TypeScriptCompilationSessionState,
  expected: TypeScriptCompilationSessionState,
  operation: string,
): void {
  if (actual !== expected) {
    throw new Error(
      `TypeScript compilation session cannot call '${operation}' while in '${actual}' state; expected '${expected}'.`,
    );
  }
}
