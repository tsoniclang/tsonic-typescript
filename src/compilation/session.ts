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
import {
  readProviderInvocationManifests,
} from "../config/provider-invocation-manifest.js";
import {
  createProviderInvocationExtension,
} from "../lowering/effect/flow/provider/source-extension.js";
import { createExternalAstPrinter } from "../print/ast-printer.js";
import { typeScriptRuntimeReference } from "../runtime/package-contract.js";
import {
  createTypeScriptRuntimeReturnExtension,
} from "../runtime/return-source-extension.js";

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
      const manifests = readProviderInvocationManifests(
        context.projectDirectory,
        options.providerInvocationManifests,
      );
      return Object.freeze({
        extensions: Object.freeze([
          createTypeScriptRuntimeReturnExtension(),
          ...(manifests.length === 0
            ? []
            : [createProviderInvocationExtension(manifests)]),
        ]),
      });
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
        options.diagnostics,
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
