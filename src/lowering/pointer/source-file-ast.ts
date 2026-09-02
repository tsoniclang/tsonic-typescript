import type { SourceFile } from "@tsonic/tsts";
import type { NodeFactory } from "@tsonic/tsts/target-ast";

import { PointerLoweringError } from "./diagnostic.js";
import {
  insertCanonicalPointerKeyMapStorage,
  type CanonicalPointerKeyMapConsumption,
} from "./map/transform.js";
import type { PointerLoweringPlan } from "./plan.js";
import {
  insertProjectedPropertyLocationClass,
} from "./projected-property-ast.js";
import { insertRootLocationClass } from "./root-location-ast.js";

export interface PointerSourceFileArtifactConsumption {
  readonly pointerKeyMaps: CanonicalPointerKeyMapConsumption;
  projectedPropertyLocationClassInserted: boolean;
  rootLocationClassInserted: boolean;
}

export function insertPointerSourceFileArtifacts(
  factory: NodeFactory,
  sourceFile: SourceFile,
  plan: PointerLoweringPlan,
  consumed: PointerSourceFileArtifactConsumption,
): SourceFile {
  let current = sourceFile;
  if (plan.rootLocationClassName !== undefined) {
    if (consumed.rootLocationClassInserted) {
      throw new PointerLoweringError("root-location class was inserted twice");
    }
    consumed.rootLocationClassInserted = true;
    current = insertRootLocationClass(
      factory,
      current,
      plan.rootLocationClassName,
    );
  }
  current = insertCanonicalPointerKeyMapStorage(
    factory,
    current,
    plan.flowPlan?.pointerKeyMapsFor(plan.sourceFile) ?? [],
    consumed.pointerKeyMaps,
  );
  if (plan.projectedPropertyLocationClassName === undefined) {
    return current;
  }
  if (consumed.projectedPropertyLocationClassInserted) {
    throw new PointerLoweringError(
      "projected-property class was inserted twice",
    );
  }
  consumed.projectedPropertyLocationClassInserted = true;
  return insertProjectedPropertyLocationClass(
    factory,
    current,
    plan.projectedPropertyLocationClassName,
  );
}
