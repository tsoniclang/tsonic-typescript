export { createTypeScriptBackend } from "./backend/typescript-backend.js";
export {
  readTypeScriptTargetOptions,
} from "./config/options.js";
export type {
  TypeScriptAstPrinterOptions,
  TypeScriptTargetOptions,
} from "./config/options.js";
export { PointerLoweringError } from "./lowering/pointer/diagnostic.js";
export {
  lowerPointers,
} from "./lowering/pointer/transform.js";
export type {
  PointerLoweringResult,
} from "./lowering/pointer/transform.js";
export {
  createExternalAstPrinter,
  decodePrinterResponse,
  encodePrinterRequest,
} from "./print/ast-printer.js";
export type {
  TypeScriptAstPrinter,
  TypeScriptPrinterBatch,
} from "./print/ast-printer.js";
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
