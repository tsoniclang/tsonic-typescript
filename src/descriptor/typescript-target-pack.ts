import type {
  TargetBackend,
  TargetBackendContext,
  TargetPack,
  TargetProviderContext,
  TargetRuntimeContributionContext,
  TargetRuntimeContributions,
  TargetSourceCompilerContributions,
  TargetToolchain,
  TargetToolchainInput,
  TargetToolchainResult,
} from "@tsonic/target-api";

import { createTypeScriptBackend } from "../backend/typescript-backend.js";
import { readTypeScriptTargetOptions } from "../config/options.js";
import { createExternalAstPrinter } from "../print/ast-printer.js";
import { typeScriptRuntimeReference } from "../runtime/package-contract.js";

export const typeScriptTargetId = "typescript";

export function createTypeScriptTargetPack(): TargetPack {
  return {
    id: typeScriptTargetId,
    displayName: "TypeScript",
    provider: {
      id: "typescript-provider",
      displayName: "TypeScript target provider",
      sourceProfileContributions() {
        return {
          declarationPolicy: {
            bundledLibraries: ["lib.es2024.d.ts"],
            installedDeclarations: "package-contract",
          },
        };
      },
      sourceCompilerContributions(
        _context: TargetProviderContext,
      ): TargetSourceCompilerContributions {
        return {};
      },
      runtimeContributions(
        _context: TargetRuntimeContributionContext,
      ): TargetRuntimeContributions {
        return {
          references: [typeScriptRuntimeReference()],
        };
      },
    },
    createBackend(context: TargetBackendContext): TargetBackend {
      const options = readTypeScriptTargetOptions(context.target);
      return createTypeScriptBackend(
        createExternalAstPrinter(options.printer),
        options.optimizations,
      );
    },
    createToolchain(): TargetToolchain {
      return {
        prepare(input: TargetToolchainInput): TargetToolchainResult {
          return {
            diagnostics: [],
            producedArtifacts: input.compileResult.artifacts.map(
              (artifact) => artifact.path,
            ),
          };
        },
      };
    },
  };
}
