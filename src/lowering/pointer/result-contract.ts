import {
  pointerOperationFactKey,
  rawPointerOperationFactKey,
} from "@tsonic/tsts";
import type { Node, PointerOperationFact } from "@tsonic/tsts";
import type { TargetSourceProgram } from "@tsonic/target-api/source";

import type {
  LoweredInputProof,
  LoweredValueContract,
} from "../value-contract.js";
import { PointerLoweringError } from "./diagnostic.js";
import type {
  ClosedPointerFlowPlan,
  PointerFlowRepresentation,
} from "./flow-plan.js";

export function createPointerResultContract(
  source: TargetSourceProgram,
  flowPlan: ClosedPointerFlowPlan | undefined,
): LoweredValueContract {
  if (flowPlan !== undefined && !flowPlan.owns(source)) {
    throw new PointerLoweringError(
      "pointer result contract received a flow plan from another checked program",
    );
  }
  return Object.freeze({
    isDefinitelyNonThenable(
      expression: Node,
      proveInput: LoweredInputProof,
    ): boolean {
      const operation = source.sourceFacts.getFact(
        expression,
        pointerOperationFactKey,
      );
      const rawOperation = source.sourceFacts.getFact(
        expression,
        rawPointerOperationFactKey,
      );
      if (operation !== undefined && rawOperation !== undefined) {
        throw new PointerLoweringError(
          "one call cannot own both typed- and raw-pointer operations",
        );
      }
      if (rawOperation !== undefined) {
        if (rawOperation.call !== expression) {
          throw new PointerLoweringError(
            "raw-pointer result fact is not attached to its exact call",
          );
        }
        return true;
      }
      if (operation === undefined) {
        return flowPlan?.valueIsDefinitelyNonThenable(expression) === true;
      }
      if (operation.call !== expression) {
        throw new PointerLoweringError(
          "pointer result fact is not attached to its exact call",
        );
      }
      return typedResultIsDefinitelyNonThenable(
        operation,
        flowPlan?.representationFor(expression) ?? "location",
        proveInput,
      );
    },
  });
}

function typedResultIsDefinitelyNonThenable(
  operation: PointerOperationFact,
  representation: PointerFlowRepresentation,
  proveInput: (input: Node) => boolean,
): boolean {
  if (representation === "location") {
    return operation.operation !== "load";
  }
  if (representation === "mutable-cell") {
    return operation.operation === "allocate" ||
      operation.operation === "store" ||
      operation.operation === "equal-pointer" ||
      operation.operation === "hash-pointer";
  }
  switch (operation.operation) {
    case "address-of":
      return proveInput(operation.storageExpression);
    case "allocate":
      return proveInput(operation.initialExpression);
    case "load":
      return proveInput(operation.pointerExpression);
    case "store":
    case "equal-pointer":
    case "hash-pointer":
    case "bind-pointer":
    case "project-pointer":
      return false;
  }
}
