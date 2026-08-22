export { compileTypeScriptTarget } from "./backend/typescript-backend.js";
export {
  readTypeScriptTargetOptions,
} from "./config/options.js";
export type {
  TypeScriptAstPrinterOptions,
  TypeScriptTargetOptions,
} from "./config/options.js";
export {
  canonicalTypeScriptOptimizationProfile,
  createTypeScriptOptimizationProfile,
} from "./lowering/profile.js";
export type {
  TypeScriptCooperativeEffectProfile,
  TypeScriptOptimizationProfile,
  TypeScriptOptimizationProfileInput,
  TypeScriptPointerFlowProfile,
  TypeScriptScalarProjectionProfile,
} from "./lowering/profile.js";
export {
  prepareTypeScriptLowering,
} from "./lowering/transform.js";
export type {
  TypeScriptLoweringPreparation,
  TypeScriptLoweringTransaction,
  TypeScriptSourceLoweringResult,
  TypeScriptSourcePlanningFailure,
} from "./lowering/transform.js";
export { PointerLoweringError } from "./lowering/pointer/diagnostic.js";
export {
  createClosedPointerFlowPlan,
} from "./lowering/pointer/flow-plan.js";
export type {
  ClosedPointerFlowPlan,
  PointerFlowBlocker,
  PointerFlowComponentSummary,
  PointerFlowRepresentation,
} from "./lowering/pointer/flow-plan.js";
export {
  createPointerRewriteSession,
  lowerPointers,
} from "./lowering/pointer/transform.js";
export type {
  PointerLoweringResult,
  PointerRewriteSession,
} from "./lowering/pointer/transform.js";
export {
  createScalarRepresentationPlan,
  scalarProjectionRetentionReasons,
} from "./lowering/scalar/plan.js";
export type {
  ScalarProjectionPlan,
  ScalarProjectionRetentionReason,
  ScalarRepresentationPlan,
  ScalarRepresentationProfile,
} from "./lowering/scalar/plan.js";
export {
  createScalarRepresentationRewriter,
  lowerScalarRepresentations,
} from "./lowering/scalar/transform.js";
export type {
  ScalarRepresentationRewriter,
  ScalarRepresentationRewriteResult,
} from "./lowering/scalar/transform.js";
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
