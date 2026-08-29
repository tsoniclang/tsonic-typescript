import type { Node } from "@tsonic/tsts";
import type { TargetSourceProgram } from "@tsonic/target-api/source";

import type { PointerProjectionDependency } from "./flow-census.js";
import type { PointerTypedFactLedger } from "./flow-fact-ledger.js";
import type {
  DirectReferenceFamilyPlan,
  DirectReferenceFamilyRetention,
} from "./flow-families.js";
import type { PointerFlowComponent } from "./flow-graph.js";
import { describePointerPointee } from "./pointee-classification.js";
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

export interface PointerSettlementPlan {
  readonly components: ReadonlyMap<
    PointerFlowComponent,
    PointerComponentSettlement
  >;
  readonly retainedContractFamilies: readonly DirectReferenceFamilyRetention[];
}

export function settlePointerComponents(
  source: TargetSourceProgram,
  components: readonly PointerFlowComponent[],
  dependencies: readonly PointerProjectionDependency[],
  facts: PointerTypedFactLedger,
  familyPlan: DirectReferenceFamilyPlan,
  representations: ReadonlyMap<Node, PointerFlowRepresentation>,
  ledger: PointerPlanningLedger,
): PointerSettlementPlan {
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
  const retainedContractFamilies = enforceRepresentationContracts(
    source,
    components,
    dependencies,
    componentByVertex,
    representations,
    settled,
    ledger,
  );
  return Object.freeze({
    components: settled,
    retainedContractFamilies,
  });

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

function enforceRepresentationContracts(
  source: TargetSourceProgram,
  components: readonly PointerFlowComponent[],
  dependencies: readonly PointerProjectionDependency[],
  componentByVertex: ReadonlyMap<
    PointerFlowComponent["vertices"][number],
    PointerFlowComponent
  >,
  representations: ReadonlyMap<Node, PointerFlowRepresentation>,
  settled: Map<PointerFlowComponent, PointerComponentSettlement>,
  ledger: PointerPlanningLedger,
): readonly DirectReferenceFamilyRetention[] {
  const componentsByFamily = new Map<Node, Set<PointerFlowComponent>>();
  const contractOccurrencesByFamily = new Map<Node, Set<Node>>();
  const familyByComponent = new Map<PointerFlowComponent, Node>();
  for (const component of components) {
    ledger.record("representation");
    const family = directReferenceFamilyIdentity(
      source,
      component,
      representations,
      ledger,
    );
    if (family === undefined) {
      continue;
    }
    familyByComponent.set(component, family);
    appendComponent(componentsByFamily, family, component);
    const contractOccurrences = representationContractOccurrences(
      source,
      component,
      representations,
      ledger,
    );
    if (contractOccurrences.length !== 0) {
      const selected = contractOccurrencesByFamily.get(family);
      if (selected === undefined) {
        contractOccurrencesByFamily.set(family, new Set(contractOccurrences));
      } else {
        for (const occurrence of contractOccurrences) {
          ledger.record("representation");
          selected.add(occurrence);
        }
      }
    }
  }
  const dependantsBySource = new Map<
    PointerFlowComponent,
    PointerProjectionDependency[]
  >();
  for (const dependency of dependencies) {
    ledger.record("representation");
    const sourceComponent = componentByVertex.get(dependency.source);
    const targetComponent = componentByVertex.get(dependency.target);
    if (sourceComponent === undefined || targetComponent === undefined) {
      throw new Error("pointer contract dependency escaped the sealed flow graph");
    }
    const selected = dependantsBySource.get(sourceComponent);
    if (selected === undefined) {
      dependantsBySource.set(sourceComponent, [dependency]);
    } else {
      selected.push(dependency);
    }
  }
  const queue = components.filter((component) =>
    settled.get(component)?.representation === "location"
  );
  const retainedFamilies = new Set<Node>();
  for (let index = 0; index < queue.length; index += 1) {
    const component = queue[index];
    if (component === undefined) {
      continue;
    }
    const family = familyByComponent.get(component);
    const contractOccurrences = family === undefined
      ? undefined
      : contractOccurrencesByFamily.get(family);
    if (family !== undefined && contractOccurrences !== undefined) {
      retainedFamilies.add(family);
      for (const related of componentsByFamily.get(family) ?? []) {
        ledger.record("representation");
        if (retainComponent(
          related,
          "representation-contract",
          [...contractOccurrences],
          settled,
          ledger,
        )) {
          queue.push(related);
        }
      }
    }
    for (const dependency of dependantsBySource.get(component) ?? []) {
      ledger.record("representation");
      const target = componentByVertex.get(dependency.target);
      if (
        target !== undefined &&
        retainComponent(
          target,
          "projection-observed",
          [dependency.operation.call],
          settled,
          ledger,
        )
      ) {
        queue.push(target);
      }
    }
  }
  return Object.freeze([...retainedFamilies].map((family) => {
    const pointerTypes = new Set<Node>();
    const operations = new Set<Node>();
    for (const component of componentsByFamily.get(family) ?? []) {
      for (const pointerType of component.pointerTypes) {
        ledger.record("evidence");
        pointerTypes.add(pointerType);
      }
      for (const operation of component.operations) {
        ledger.record("evidence");
        operations.add(operation);
      }
    }
    return Object.freeze({
      identity: family,
      pointerTypeCount: pointerTypes.size,
      operationCount: operations.size,
      blockerEvidence: Object.freeze([Object.freeze({
        reason: "representation-contract" as const,
        occurrences: Object.freeze([
          ...(contractOccurrencesByFamily.get(family) ?? []),
        ]),
      })]),
    });
  }));
}

function directReferenceFamilyIdentity(
  source: TargetSourceProgram,
  component: PointerFlowComponent,
  representations: ReadonlyMap<Node, PointerFlowRepresentation>,
  ledger: PointerPlanningLedger,
): Node | undefined {
  let selected: Node | undefined;
  let hasDirectFamilyEvidence = false;
  for (const node of componentRepresentationNodes(component)) {
    ledger.record("representation");
    const representation = representations.get(node);
    hasDirectFamilyEvidence ||= representation !== undefined &&
      representation !== "location";
  }
  if (!hasDirectFamilyEvidence) {
    return undefined;
  }
  for (const evidence of component.pointees) {
    ledger.record("representation");
    const description = describePointerPointee(
      source,
      evidence.anchor,
      evidence.type,
    );
    if (
      description?.category !== "direct-reference" ||
      typeof description.identity === "string"
    ) {
      return undefined;
    }
    if (selected !== undefined && selected !== description.identity) {
      return undefined;
    }
    selected = description.identity;
  }
  return selected;
}

function representationContractOccurrences(
  source: TargetSourceProgram,
  component: PointerFlowComponent,
  representations: ReadonlyMap<Node, PointerFlowRepresentation>,
  ledger: PointerPlanningLedger,
): readonly Node[] {
  if (
    component.operations.length !== 0 ||
    component.producers.length !== 0 ||
    component.blockers.length === 0
  ) {
    return [];
  }
  return component.pointerTypes.filter((node) => {
    ledger.record("representation");
    return source.ast.is.IsTypeReferenceNode(node) &&
      representations.get(node) !== undefined &&
      representations.get(node) !== "location";
  });
}

function retainComponent(
  component: PointerFlowComponent,
  reason: "projection-observed" | "representation-contract",
  occurrences: readonly Node[],
  settled: Map<PointerFlowComponent, PointerComponentSettlement>,
  ledger: PointerPlanningLedger,
): boolean {
  const current = settled.get(component);
  if (current === undefined) {
    throw new Error("pointer representation contract lost a component settlement");
  }
  if (current.representation === "location") {
    return false;
  }
  const evidence = new Map(
    current.decision.blockerEvidence.map((entry) => [
      entry.reason,
      new Set(entry.occurrences),
    ] as const),
  );
  const selected = evidence.get(reason);
  if (selected === undefined) {
    evidence.set(reason, new Set(occurrences));
  } else {
    for (const occurrence of occurrences) {
      ledger.record("representation");
      selected.add(occurrence);
    }
  }
  const blockerEvidence = Object.freeze([...evidence]
    .sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)
    .map(([blocker, selectedOccurrences]) => Object.freeze({
      reason: blocker,
      occurrences: Object.freeze([...selectedOccurrences]),
    })));
  settled.set(component, Object.freeze({
    decision: Object.freeze({
      representation: "location" as const,
      blockers: Object.freeze(blockerEvidence.map((entry) => entry.reason)),
      blockerEvidence,
    }),
    representation: "location",
    directProjectionCount: 0,
  }));
  return true;
}

function appendComponent<Owner, Value>(
  index: Map<Owner, Set<Value>>,
  owner: Owner,
  value: Value,
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
