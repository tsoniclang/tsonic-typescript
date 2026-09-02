export type TypeScriptPointerFlowProfile = "location" | "closed-direct";
export type TypeScriptScalarProjectionProfile = "preserve" | "closed-direct";
export type TypeScriptRepresentationProjectionProfile =
  | "preserve"
  | "closed-direct";

export interface TypeScriptOptimizationProfileInput {
  readonly pointerFlows: TypeScriptPointerFlowProfile;
  readonly scalarProjections: TypeScriptScalarProjectionProfile;
  readonly representationProjections: TypeScriptRepresentationProjectionProfile;
}

export interface TypeScriptOptimizationProfile
  extends TypeScriptOptimizationProfileInput {
  readonly identity: string;
}

const profileCache = new Map<string, TypeScriptOptimizationProfile>();
const canonicalProfile = createTypeScriptOptimizationProfile({
  pointerFlows: "location",
  scalarProjections: "preserve",
  representationProjections: "preserve",
});

export function canonicalTypeScriptOptimizationProfile(): TypeScriptOptimizationProfile {
  return canonicalProfile;
}

export function createTypeScriptOptimizationProfile(
  input: TypeScriptOptimizationProfileInput,
): TypeScriptOptimizationProfile {
  assertChoice(input.pointerFlows, "pointerFlows", "location");
  assertChoice(input.scalarProjections, "scalarProjections", "preserve");
  assertChoice(
    input.representationProjections,
    "representationProjections",
    "preserve",
  );
  const identity = [
    "typescript-optimization-v5",
    `pointer=${input.pointerFlows}`,
    `scalar=${input.scalarProjections}`,
    `representations=${input.representationProjections}`,
  ].join("/");
  const cached = profileCache.get(identity);
  if (cached !== undefined) {
    return cached;
  }
  const profile = Object.freeze({
    identity,
    pointerFlows: input.pointerFlows,
    scalarProjections: input.scalarProjections,
    representationProjections: input.representationProjections,
  });
  profileCache.set(identity, profile);
  return profile;
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
