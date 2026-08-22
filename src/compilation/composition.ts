import type {
  TargetProviderDescriptor,
  TargetSurfaceImplementation,
} from "@tsonic/target-api";

import { typeScriptRuntimeModule } from "../runtime/package-contract.js";

export const typeScriptTargetProvider: TargetProviderDescriptor = Object.freeze({
  id: "typescript-provider",
  displayName: "TypeScript target provider",
  moduleOwnership: Object.freeze([
    Object.freeze({ specifierPrefix: typeScriptRuntimeModule }),
  ]),
});

export const typeScriptTargetSurfaces: readonly TargetSurfaceImplementation[] =
  Object.freeze([]);
