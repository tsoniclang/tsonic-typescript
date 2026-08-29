import type { Node, PointerOperationFact } from "@tsonic/tsts";
import type { TargetSourceProgram } from "@tsonic/target-api/source";

import type {
  GeneratedBindingName,
  SourceFileGeneratedNames,
} from "../../generated-names.js";
import type { ClosedPointerFlowPlan } from "../flow-plan.js";
import type { LocationBinding } from "../location-binding-plan.js";

export const staticPropertyLocationMinimumOccurrences = 8;

export interface StaticPropertyLocationClassPlan {
  readonly propertyName: string;
  readonly className: GeneratedBindingName;
  readonly operationCount: number;
}

export interface StaticPropertyLocationPlan {
  readonly operations: ReadonlyMap<Node, StaticPropertyLocationClassPlan>;
  readonly classes: readonly StaticPropertyLocationClassPlan[];
  readonly operationCount: number;
}

export function planStaticPropertyLocations(
  source: TargetSourceProgram,
  operations: ReadonlyMap<Node, PointerOperationFact>,
  addressBindings: ReadonlyMap<Node, LocationBinding>,
  flowPlan: ClosedPointerFlowPlan | undefined,
  generatedNames: SourceFileGeneratedNames,
): StaticPropertyLocationPlan {
  if (flowPlan === undefined) {
    return emptyPlan;
  }
  const candidates = new Map<string, Node[]>();
  for (const operation of operations.values()) {
    if (
      operation.operation !== "address-of" ||
      flowPlan.representationFor(operation.call) !== "location" ||
      flowPlan.projectionFusionFor(operation.call) !== undefined ||
      flowPlan.ownsFusedProjection(operation.call) ||
      flowPlan.projectedPropertyLocationFor(operation.call) !== undefined ||
      flowPlan.ownsProjectedPropertyAddress(operation.call)
    ) {
      continue;
    }
    const propertyName = directStaticPropertyName(
      source,
      operation,
      operations,
      addressBindings,
    );
    if (propertyName === undefined) {
      continue;
    }
    const family = candidates.get(propertyName) ?? [];
    family.push(operation.call);
    candidates.set(propertyName, family);
  }

  const selectedOperations = new Map<Node, StaticPropertyLocationClassPlan>();
  const classes: StaticPropertyLocationClassPlan[] = [];
  for (const [propertyName, calls] of [...candidates].sort(compareNames)) {
    if (calls.length < staticPropertyLocationMinimumOccurrences) {
      continue;
    }
    const selected = Object.freeze({
      propertyName,
      className: generatedNames.reserve(
        `$PropertyLocationFor_${propertyName}`,
      ),
      operationCount: calls.length,
    });
    classes.push(selected);
    for (const call of calls) {
      selectedOperations.set(call, selected);
    }
  }
  return Object.freeze({
    operations: selectedOperations,
    classes: Object.freeze(classes),
    operationCount: selectedOperations.size,
  });
}

function directStaticPropertyName(
  source: TargetSourceProgram,
  operation: Extract<PointerOperationFact, { readonly operation: "address-of" }>,
  operations: ReadonlyMap<Node, PointerOperationFact>,
  addressBindings: ReadonlyMap<Node, LocationBinding>,
): string | undefined {
  if (!source.ast.is.IsPropertyAccessExpression(operation.storageExpression)) {
    return undefined;
  }
  const property = source.ast.as.AsPropertyAccessExpression(
    operation.storageExpression,
  );
  if (
    property?.Expression === undefined ||
    property.name === undefined ||
    !source.ast.is.IsIdentifier(property.name)
  ) {
    return undefined;
  }
  const owner = property.Expression;
  if (source.ast.is.IsIdentifier(owner)) {
    return addressBindings.has(owner)
      ? undefined
      : source.ast.text(property.name);
  }
  if (
    source.ast.is.IsPropertyAccessExpression(owner) ||
    source.ast.is.IsElementAccessExpression(owner) ||
    operations.get(owner)?.operation === "load"
  ) {
    return undefined;
  }
  return source.ast.text(property.name);
}

function compareNames(
  left: readonly [string, readonly Node[]],
  right: readonly [string, readonly Node[]],
): number {
  return left[0] < right[0] ? -1 : left[0] > right[0] ? 1 : 0;
}

const emptyPlan: StaticPropertyLocationPlan = Object.freeze({
  operations: new Map(),
  classes: Object.freeze([]),
  operationCount: 0,
});
