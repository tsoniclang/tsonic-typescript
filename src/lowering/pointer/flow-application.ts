import type { Node, PointerOperationFact } from "@tsonic/tsts";

import type {
  ClosedPointerFlowPlan,
  PointerFlowRepresentation,
} from "./flow-plan.js";
import type { PointerLoweringPlan } from "./plan.js";

export function pointerLoweringPlanUsesRuntime(
  plan: PointerLoweringPlan,
): boolean {
  if (plan.rawPointerOperations.size !== 0 || plan.rawPointerTypes.size !== 0) {
    return true;
  }
  for (const pointerType of plan.pointerTypes) {
    if (pointerFlowRepresentation(plan, pointerType) === "location") {
      return true;
    }
  }
  for (const operation of plan.operations.values()) {
    if (pointerOperationIsFused(plan.flowPlan, operation.call)) {
      continue;
    }
    if (
      operationNeedsRuntime(
        operation,
        pointerFlowRepresentation(plan, operation.call),
      )
    ) {
      return true;
    }
  }
  return false;
}

export function pointerOperationIsFused(
  flowPlan: ClosedPointerFlowPlan | undefined,
  node: Node,
): boolean {
  return flowPlan?.projectionFusionFor(node) !== undefined ||
    flowPlan?.ownsFusedProjection(node) === true;
}

export function pointerFlowRepresentation(
  plan: PointerLoweringPlan,
  node: Node,
): PointerFlowRepresentation {
  return flowRepresentation(plan.flowPlan, node);
}

export function pointerOperationUsesRuntimeValue(
  operation: PointerOperationFact,
  flowPlan: ClosedPointerFlowPlan | undefined,
): boolean {
  return operationUsesRuntimeValue(
    operation,
    flowRepresentation(flowPlan, operation.call),
  );
}

function flowRepresentation(
  flowPlan: ClosedPointerFlowPlan | undefined,
  node: Node,
): PointerFlowRepresentation {
  return flowPlan?.representationFor(node) ?? "location";
}

function operationUsesRuntimeValue(
  operation: PointerOperationFact,
  representation: PointerFlowRepresentation,
): boolean {
  return representation === "direct-object"
    ? operation.operation === "hash-pointer"
    : representation === "location" &&
      operation.operation !== "load" &&
      operation.operation !== "store";
}

function operationNeedsRuntime(
  operation: PointerOperationFact,
  representation: PointerFlowRepresentation,
): boolean {
  return operationUsesRuntimeValue(operation, representation) ||
    representation === "location" &&
    operation.explicitPointeeTypeNode !== undefined;
}
