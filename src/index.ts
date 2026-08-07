export { createTypeScriptBackend } from "./backend/typescript-backend.js";
export {
  readTypeScriptTargetOptions,
} from "./config/options.js";
export type {
  TypeScriptAstPrinterOptions,
  TypeScriptTargetOptions,
} from "./config/options.js";
export { TypedLocationLoweringError } from "./lowering/typed-location/diagnostic.js";
export {
  lowerTypedLocations,
} from "./lowering/typed-location/transform.js";
export type {
  TypedLocationLoweringResult,
} from "./lowering/typed-location/transform.js";
export {
  createExternalAstPrinter,
  decodePrinterResponse,
  encodePrinterRequest,
} from "./print/ast-printer.js";
export type { TypeScriptAstPrinter } from "./print/ast-printer.js";
export {
  createTypeScriptTargetPack,
  typeScriptTargetId,
} from "./descriptor/typescript-target-pack.js";

import {
  createTypeScriptTargetPack,
  typeScriptTargetId,
} from "./descriptor/typescript-target-pack.js";

export function createTsonicPlugin() {
  return {
    kind: "target" as const,
    id: "@tsonic/target-typescript",
    targetId: typeScriptTargetId,
    createTargetPack: createTypeScriptTargetPack,
  };
}
