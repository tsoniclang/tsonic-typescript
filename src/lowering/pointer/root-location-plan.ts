import type { Node, PointerOperationFact } from "@tsonic/tsts";

import type {
  GeneratedBindingName,
  SourceFileGeneratedNames,
} from "../generated-names.js";
import { pointerOperationIsFused } from "./flow-application.js";
import type { ClosedPointerFlowPlan } from "./flow-plan.js";

export function planRootLocationClass(
  operations: ReadonlyMap<Node, PointerOperationFact>,
  flowPlan: ClosedPointerFlowPlan | undefined,
  generatedNames: SourceFileGeneratedNames,
): GeneratedBindingName | undefined {
  for (const operation of operations.values()) {
    if (
      operation.operation === "allocate" &&
      !pointerOperationIsFused(flowPlan, operation.call) &&
      (flowPlan?.representationFor(operation.call) ?? "location") === "location"
    ) {
      return generatedNames.reserve("$RootLocation");
    }
  }
  return undefined;
}
