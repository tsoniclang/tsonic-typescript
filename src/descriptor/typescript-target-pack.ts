import type {
  TargetPack,
  TargetToolchain,
  TargetToolchainContext,
} from "@tsonic/target-api";

import {
  createTypeScriptCompilationSession,
  typeScriptTargetProvider,
  typeScriptTargetSurfaces,
} from "../compilation/index.js";
import {
  createTypeScriptToolchain,
} from "../toolchain/typescript-toolchain.js";

export const typeScriptTargetId = "typescript";

export function createTypeScriptTargetPack(): TargetPack {
  return Object.freeze({
    id: typeScriptTargetId,
    displayName: "TypeScript",
    provider: typeScriptTargetProvider,
    surfaces: typeScriptTargetSurfaces,
    createCompilationSession: createTypeScriptCompilationSession,
    createToolchain(context: TargetToolchainContext): TargetToolchain {
      return createTypeScriptToolchain(context);
    },
  });
}
