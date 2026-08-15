import type { Node, PointerOperationFact } from "@tsonic/tsts";
import type { TargetSourceProgram } from "@tsonic/target-api";

import type {
  StorageOwnerInvocationTransport,
  StorageOwnerTransportContract,
} from "../storage-owner-transport.js";
import type { ClosedPointerFlowPlan } from "./flow-plan.js";

export function createPointerStorageOwnerTransport(
  source: TargetSourceProgram,
  plan: ClosedPointerFlowPlan,
): StorageOwnerTransportContract {
  if (!plan.owns(source)) {
    throw new Error(
      "pointer owner transport received a flow plan from another checked program",
    );
  }
  return Object.freeze({
    transportFor(call: Node): StorageOwnerInvocationTransport | undefined {
      const operation = plan.operationFor(call);
      return operation === undefined ? undefined : pointerTransport(operation);
    },
  });
}

function pointerTransport(
  operation: PointerOperationFact,
): StorageOwnerInvocationTransport | undefined {
  switch (operation.operation) {
    case "address-of":
      return transport(
        [operation.storageExpression],
        [operation.storageExpression],
      );
    case "allocate":
      return transport(
        [operation.initialExpression],
        [operation.initialExpression],
      );
    case "load":
      return transport(
        [operation.pointerExpression],
        [operation.pointerExpression],
      );
    case "store":
      return transport(
        [operation.pointerExpression, operation.valueExpression],
        [],
      );
    case "equal-pointer":
      return transport(
        [operation.leftExpression, operation.rightExpression],
        [],
      );
    case "hash-pointer":
      return transport([operation.pointerExpression], []);
    case "bind-pointer":
    case "project-pointer":
      return undefined;
  }
}

function transport(
  inputs: readonly Node[],
  resultInputs: readonly Node[],
): StorageOwnerInvocationTransport {
  return Object.freeze({
    inputs: Object.freeze([...inputs]),
    resultInputs: Object.freeze([...resultInputs]),
  });
}
