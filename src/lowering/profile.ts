export type TypeScriptPointerFlowProfile = "location" | "closed-direct";
export type TypeScriptScalarProjectionProfile = "preserve" | "closed-direct";

export interface TypeScriptOptimizationProfile {
  readonly pointerFlows: TypeScriptPointerFlowProfile;
  readonly scalarProjections: TypeScriptScalarProjectionProfile;
}

export function canonicalTypeScriptOptimizationProfile(): TypeScriptOptimizationProfile {
  return Object.freeze({
    pointerFlows: "location",
    scalarProjections: "preserve",
  });
}
