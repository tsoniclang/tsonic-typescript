import type {
  TargetBackend,
  TargetBackendContext,
  TargetPack,
  TargetProviderContext,
  TargetSourceCompilerContributions,
  TargetToolchain,
  TargetToolchainInput,
  TargetToolchainResult,
} from "@tsonic/target-api";

import { createTypeScriptBackend } from "../backend/typescript-backend.js";
import { readTypeScriptTargetOptions } from "../config/options.js";
import { createExternalAstPrinter } from "../print/ast-printer.js";

export const typeScriptTargetId = "typescript";

export function createTypeScriptTargetPack(): TargetPack {
  return {
    id: typeScriptTargetId,
    displayName: "TypeScript",
    provider: {
      id: "typescript-provider",
      displayName: "TypeScript target provider",
      sourceCompilerContributions(
        _context: TargetProviderContext,
      ): TargetSourceCompilerContributions {
        return {};
      },
    },
    createBackend(context: TargetBackendContext): TargetBackend {
      const options = readTypeScriptTargetOptions(context.target);
      return createTypeScriptBackend(createExternalAstPrinter(options.printer));
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
