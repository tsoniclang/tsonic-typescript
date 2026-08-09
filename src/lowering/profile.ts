export type TypeScriptPointerFlowProfile = "location" | "closed-direct";
export type TypeScriptScalarProjectionProfile = "preserve" | "closed-direct";
export type TypeScriptCooperativeEffectProfile = "preserve" | "closed-direct";

export interface TypeScriptOptimizationProfile {
  readonly pointerFlows: TypeScriptPointerFlowProfile;
  readonly scalarProjections: TypeScriptScalarProjectionProfile;
  readonly cooperativeEffects: TypeScriptCooperativeEffectProfile;
}

export function canonicalTypeScriptOptimizationProfile(): TypeScriptOptimizationProfile {
  return Object.freeze({
    pointerFlows: "location",
    scalarProjections: "preserve",
    cooperativeEffects: "preserve",
  });
}
