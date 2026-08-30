import type { Node, PointerOperationFact } from "@tsonic/tsts";
import type { TargetSourceProgram } from "@tsonic/target-api/source";

import type {
  GeneratedBindingName,
  SourceFileGeneratedNames,
} from "../generated-names.js";
import type { ClosedPointerFlowPlan } from "./flow-plan.js";
import { pointerTypeCanBeUndefined } from "./nullability.js";

export interface ReferenceHashPlan {
  readonly nullable: boolean;
  readonly parameterName?: GeneratedBindingName;
}

export function planReferenceHashes(
  source: TargetSourceProgram,
  operations: ReadonlyMap<Node, PointerOperationFact>,
  flowPlan: ClosedPointerFlowPlan | undefined,
  generatedNames: SourceFileGeneratedNames,
): ReadonlyMap<Node, ReferenceHashPlan> {
  const result = new Map<Node, ReferenceHashPlan>();
  for (const operation of operations.values()) {
    const representation = flowPlan?.representationFor(operation.call);
    if (
      operation.operation !== "hash-pointer" ||
      representation !== "direct-object" && representation !== "mutable-cell"
    ) {
      continue;
    }
    const nullable = pointerTypeCanBeUndefined(
      source,
      operation.pointerExpression,
      operation.pointerType,
    );
    result.set(
      operation.call,
      Object.freeze({
        nullable,
        ...(nullable
          ? { parameterName: generatedNames.reserve("$pointer") }
          : {}),
      }),
    );
  }
  return result;
}
