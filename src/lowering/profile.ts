export type TypeScriptPointerFlowProfile = "location" | "closed-direct";
export type TypeScriptScalarProjectionProfile = "preserve" | "closed-direct";
export type TypeScriptRepresentationProjectionProfile = "preserve" | "closed-direct";
export type TypeScriptCooperativeEffectProfile =
  | "preserve"
  | "closed-direct"
  | "closed-program";
export type TypeScriptActiveCooperativeEffectProfile = Exclude<
  TypeScriptCooperativeEffectProfile,
  "preserve"
>;
export type TypeScriptInterfaceDispatchProfile =
  | "open-structural"
  | "declared-closed";

export interface TypeScriptOptimizationProfileInput {
  readonly pointerFlows: TypeScriptPointerFlowProfile;
  readonly scalarProjections: TypeScriptScalarProjectionProfile;
  readonly representationProjections?: TypeScriptRepresentationProjectionProfile;
  readonly cooperativeEffects: TypeScriptCooperativeEffectProfile;
  readonly interfaceDispatch?: TypeScriptInterfaceDispatchProfile;
}

export interface TypeScriptOptimizationProfile {
  readonly identity: string;
  readonly pointerFlows: TypeScriptPointerFlowProfile;
  readonly scalarProjections: TypeScriptScalarProjectionProfile;
  readonly representationProjections: TypeScriptRepresentationProjectionProfile;
  readonly cooperativeEffects: TypeScriptCooperativeEffectProfile;
  readonly interfaceDispatch: TypeScriptInterfaceDispatchProfile;
}

const profileCache = new Map<string, TypeScriptOptimizationProfile>();
const canonicalProfile = createTypeScriptOptimizationProfile({
  pointerFlows: "location",
  scalarProjections: "preserve",
  representationProjections: "preserve",
  cooperativeEffects: "preserve",
  interfaceDispatch: "open-structural",
});

export function canonicalTypeScriptOptimizationProfile(): TypeScriptOptimizationProfile {
  return canonicalProfile;
}

export function createTypeScriptOptimizationProfile(
  input: TypeScriptOptimizationProfileInput,
): TypeScriptOptimizationProfile {
  assertChoice(input.pointerFlows, "pointerFlows", "location");
  assertChoice(input.scalarProjections, "scalarProjections", "preserve");
  const representationProjections = input.representationProjections ?? "preserve";
  assertChoice(
    representationProjections,
    "representationProjections",
    "preserve",
  );
  assertCooperativeEffects(input.cooperativeEffects);
  const interfaceDispatch = input.interfaceDispatch ?? "open-structural";
  assertInterfaceDispatch(interfaceDispatch);
  const identity = [
    "typescript-optimization-v3",
    `pointer=${input.pointerFlows}`,
    `scalar=${input.scalarProjections}`,
    `representations=${representationProjections}`,
    `effects=${input.cooperativeEffects}`,
    `interfaces=${interfaceDispatch}`,
  ].join("/");
  const cached = profileCache.get(identity);
  if (cached !== undefined) {
    return cached;
  }
  const profile = Object.freeze({
    identity,
    pointerFlows: input.pointerFlows,
    scalarProjections: input.scalarProjections,
    representationProjections,
    cooperativeEffects: input.cooperativeEffects,
    interfaceDispatch,
  });
  profileCache.set(identity, profile);
  return profile;
}

function assertInterfaceDispatch(
  value: unknown,
): asserts value is TypeScriptInterfaceDispatchProfile {
  if (value !== "open-structural" && value !== "declared-closed") {
    throw new Error(
      "TypeScript target optimization 'interfaceDispatch' must be 'open-structural' or 'declared-closed'",
    );
  }
}

function assertCooperativeEffects(
  value: unknown,
): asserts value is TypeScriptCooperativeEffectProfile {
  if (
    value !== "preserve" &&
    value !== "closed-direct" &&
    value !== "closed-program"
  ) {
    throw new Error(
      "TypeScript target optimization 'cooperativeEffects' must be 'preserve', 'closed-direct', or 'closed-program'",
    );
  }
}

function assertChoice<Canonical extends string>(
  value: unknown,
  name: string,
  canonical: Canonical,
): asserts value is Canonical | "closed-direct" {
  if (value !== canonical && value !== "closed-direct") {
    throw new Error(
      `TypeScript target optimization '${name}' must be '${canonical}' or 'closed-direct'`,
    );
  }
}
