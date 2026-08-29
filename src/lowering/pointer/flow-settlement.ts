import type { Node } from "@tsonic/tsts";
import type { TargetSourceProgram } from "@tsonic/target-api/source";

import type { PointerProjectionDependency } from "./flow-census.js";
import type { PointerTypedFactLedger } from "./flow-fact-ledger.js";
import type { DirectReferenceFamilyPlan } from "./flow-families.js";
import type { PointerFlowComponent } from "./flow-graph.js";
import {
  selectPointerFlowRepresentation,
  type PointerFlowDecision,
  type PointerFlowRepresentation,
} from "./flow-representation.js";
import type { PointerPlanningLedger } from "./planning-ledger.js";

export interface PointerComponentSettlement {
  readonly decision: PointerFlowDecision;
  readonly representation: PointerFlowRepresentation;
  readonly directProjectionCount: number;
}

export function settlePointerComponents(
  source: TargetSourceProgram,
  components: readonly PointerFlowComponent[],
  dependencies: readonly PointerProjectionDependency[],
  facts: PointerTypedFactLedger,
  familyPlan: DirectReferenceFamilyPlan,
  representations: ReadonlyMap<Node, PointerFlowRepresentation>,
  ledger: PointerPlanningLedger,
): ReadonlyMap<PointerFlowComponent, PointerComponentSettlement> {
  const componentByVertex = new Map<
    PointerFlowComponent["vertices"][number],
    PointerFlowComponent
  >();
  for (const component of components) {
    for (const vertex of component.vertices) {
      ledger.record("representation");
      componentByVertex.set(vertex, component);
    }
  }
  const dependenciesByTarget = new Map<
    PointerFlowComponent,
    PointerProjectionDependency[]
  >();
  const sourceComponentsByTarget = new Map<
    PointerFlowComponent,
    Set<PointerFlowComponent>
  >();
  const dependantsBySource = new Map<
    PointerFlowComponent,
    Set<PointerFlowComponent>
  >();
  for (const dependency of dependencies) {
    ledger.record("representation");
    const target = componentByVertex.get(dependency.target);
    const sourceComponent = componentByVertex.get(dependency.source);
    if (target === undefined || sourceComponent === undefined) {
      throw new Error("pointer projection dependency escaped the sealed flow graph");
    }
    const selected = dependenciesByTarget.get(target);
    if (selected === undefined) {
      dependenciesByTarget.set(target, [dependency]);
    } else {
      selected.push(dependency);
    }
    appendComponent(sourceComponentsByTarget, target, sourceComponent);
    appendComponent(dependantsBySource, sourceComponent, target);
  }
  const settled = new Map<PointerFlowComponent, PointerComponentSettlement>();
  const pending = new Set(components);
  const unresolvedSources = new Map<PointerFlowComponent, number>();
  const ready: PointerFlowComponent[] = [];
  for (const component of components) {
    ledger.record("representation");
    const count = sourceComponentsByTarget.get(component)?.size ?? 0;
    unresolvedSources.set(component, count);
    if (count === 0) {
      ready.push(component);
    }
  }
  for (let index = 0; index < ready.length; index += 1) {
    const component = ready[index];
    if (component === undefined || !pending.has(component)) {
      continue;
    }
    settle(component, dependenciesByTarget.get(component) ?? [], true);
    pending.delete(component);
    for (const dependant of dependantsBySource.get(component) ?? []) {
      ledger.record("representation");
      const remaining = (unresolvedSources.get(dependant) ?? 0) - 1;
      if (remaining < 0) {
        throw new Error("pointer projection dependency count became negative");
      }
      unresolvedSources.set(dependant, remaining);
      if (remaining === 0) {
        ready.push(dependant);
      }
    }
  }
  for (const component of components) {
    if (!pending.has(component)) {
      continue;
    }
    settle(component, dependenciesByTarget.get(component) ?? [], false);
    pending.delete(component);
  }
  return settled;

  function settle(
    component: PointerFlowComponent,
    selected: readonly PointerProjectionDependency[],
    dependenciesMayOptimize: boolean,
  ): void {
    const directProjectionCalls = new Set<Node>();
    const hasStore = component.operations.some((node) => {
      ledger.record("representation");
      return facts.operationFor(node)?.operation === "store";
    });
    const projectedComponentMayOptimize = dependenciesMayOptimize &&
      component.blockers.length === 0 && !hasStore;
    if (projectedComponentMayOptimize) {
      for (const dependency of selected) {
        ledger.record("representation");
        const sourceComponent = componentByVertex.get(dependency.source);
        const sourceSettlement = sourceComponent === undefined
          ? undefined
          : settled.get(sourceComponent);
        if (
          sourceSettlement?.representation === "direct-object" ||
          sourceSettlement?.representation === "direct-snapshot"
        ) {
          directProjectionCalls.add(dependency.operation.call);
        }
      }
    }
    const decision = selectPointerFlowRepresentation(
      source,
      component,
      facts,
      (storeCall) =>
        familyPlan.directObjectReplacementForStore(storeCall) !== undefined,
      ledger,
      (operation) => directProjectionCalls.has(operation.call),
    );
    const allDependenciesDirect = directProjectionCalls.size === selected.length;
    const representation = allDependenciesDirect
      ? finalComponentRepresentation(
          component,
          decision,
          representations,
          ledger,
        )
      : "location";
    settled.set(component, Object.freeze({
      decision,
      representation,
      directProjectionCount: representation === "location"
        ? 0
        : directProjectionCalls.size,
    }));
  }
}

function appendComponent(
  index: Map<PointerFlowComponent, Set<PointerFlowComponent>>,
  owner: PointerFlowComponent,
  value: PointerFlowComponent,
): void {
  const selected = index.get(owner);
  if (selected === undefined) {
    index.set(owner, new Set([value]));
  } else {
    selected.add(value);
  }
}

export function componentRepresentationNodes(
  component: PointerFlowComponent,
): readonly Node[] {
  return [...component.operations, ...component.pointerTypes];
}

function finalComponentRepresentation(
  component: PointerFlowComponent,
  decision: PointerFlowDecision,
  representations: ReadonlyMap<Node, PointerFlowRepresentation>,
  ledger: PointerPlanningLedger,
): PointerFlowRepresentation {
  const selected = new Set<PointerFlowRepresentation>();
  for (const node of componentRepresentationNodes(component)) {
    ledger.record("representation");
    const representation = representations.get(node);
    if (representation !== undefined) {
      selected.add(representation);
    }
  }
  if (decision.representation !== "location" && !selected.has("location")) {
    return decision.representation;
  }
  if (selected.size === 0) {
    return decision.representation;
  }
  if (selected.has("location")) {
    return "location";
  }
  if (selected.size !== 1) {
    throw new Error("pointer component selected multiple representations");
  }
  const representation = [...selected][0];
  if (representation === undefined) {
    throw new Error("pointer component lost its selected representation");
  }
  return representation;
}
