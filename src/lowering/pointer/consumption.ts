import type { Node } from "@tsonic/tsts";

import { PointerLoweringError } from "./diagnostic.js";
import {
  assertCanonicalPointerKeyMapConsumption,
  createCanonicalPointerKeyMapConsumption,
  type CanonicalPointerKeyMapConsumption,
} from "./map/transform.js";
import type { PointerLoweringPlan } from "./plan.js";

export interface PointerLoweringConsumption {
  readonly operations: Set<Node>;
  readonly pointerTypes: Set<Node>;
  readonly rawPointerOperations: Set<Node>;
  readonly rawPointerTypes: Set<Node>;
  readonly locationBindings: Set<Node>;
  readonly removableMarkerDeclarations: Set<Node>;
  readonly inferenceStabilizations: Set<Node>;
  readonly directObjectReplacements: Set<Node>;
  readonly staticPropertyLocations: Set<Node>;
  readonly pointerKeyMaps: CanonicalPointerKeyMapConsumption;
  projectedPropertyLocationClassInserted: boolean;
  staticPropertyLocationClassesInserted: boolean;
}

export function createPointerLoweringConsumption(): PointerLoweringConsumption {
  return {
    operations: new Set(),
    pointerTypes: new Set(),
    rawPointerOperations: new Set(),
    rawPointerTypes: new Set(),
    locationBindings: new Set(),
    removableMarkerDeclarations: new Set(),
    inferenceStabilizations: new Set(),
    directObjectReplacements: new Set(),
    staticPropertyLocations: new Set(),
    pointerKeyMaps: createCanonicalPointerKeyMapConsumption(),
    projectedPropertyLocationClassInserted: false,
    staticPropertyLocationClassesInserted: false,
  };
}

export function assertCompletePointerLoweringConsumption(
  plan: PointerLoweringPlan,
  consumed: PointerLoweringConsumption,
): void {
  assertCount("pointer operations", consumed.operations, plan.operations.size);
  assertCount("pointer types", consumed.pointerTypes, plan.pointerTypes.size);
  assertCount(
    "raw-pointer operations",
    consumed.rawPointerOperations,
    plan.rawPointerOperations.size,
  );
  assertCanonicalPointerKeyMapConsumption(
    plan.flowPlan?.pointerKeyMapsFor(plan.sourceFile) ?? [],
    consumed.pointerKeyMaps,
  );
  assertCount(
    "raw-pointer types",
    consumed.rawPointerTypes,
    plan.rawPointerTypes.size,
  );
  const parameterCount = [...plan.prologueBindingsByBody.values()].reduce(
    (count, bindings) =>
      count + bindings.filter((binding) => binding.kind === "parameter").length,
    0,
  );
  assertCount(
    "location bindings",
    consumed.locationBindings,
    plan.localBindings.size + parameterCount,
  );
  assertCount(
    "removable marker declarations",
    consumed.removableMarkerDeclarations,
    plan.removableMarkerDeclarations.size,
  );
  assertCount(
    "pointer inference stabilizations",
    consumed.inferenceStabilizations,
    plan.inferenceStabilizations.size,
  );
  assertCount(
    "direct-object replacements",
    consumed.directObjectReplacements,
    plan.flowPlan?.directObjectReplacementsFor(plan.sourceFile).length ?? 0,
  );
  assertCount(
    "static property locations",
    consumed.staticPropertyLocations,
    plan.staticPropertyLocations.size,
  );
  if (
    consumed.projectedPropertyLocationClassInserted !==
      (plan.projectedPropertyLocationClassName !== undefined)
  ) {
    throw new PointerLoweringError(
      "projected-property class insertion was not consumed exactly once",
    );
  }
  if (
    consumed.staticPropertyLocationClassesInserted !==
      (plan.staticPropertyLocationClasses.length !== 0)
  ) {
    throw new PointerLoweringError(
      "static property-location class insertion was not consumed exactly once",
    );
  }
}

function assertCount(
  subject: string,
  consumed: ReadonlySet<Node>,
  expected: number,
): void {
  if (consumed.size !== expected) {
    throw new PointerLoweringError(
      `consumed ${consumed.size} ${subject}, expected ${expected}`,
    );
  }
}
