import type { Node } from "@tsonic/tsts";
import type { TargetSourceProgram } from "@tsonic/target-api/source";

import type { LoweredValueContract } from "../value-contract.js";
import type { ScalarRepresentationPlan } from "./plan.js";

export function createScalarResultContract(
  source: TargetSourceProgram,
  plan: ScalarRepresentationPlan,
): LoweredValueContract {
  if (!plan.owns(source)) {
    throw new Error(
      "scalar result contract received a plan from another checked program",
    );
  }
  return Object.freeze({
    isDefinitelyNonThenable(expression: Node): boolean {
      return plan.projectionFor(expression) !== undefined;
    },
  });
}
