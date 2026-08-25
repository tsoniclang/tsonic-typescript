import type { Node } from "@tsonic/tsts";
import type { TargetSourceProgram } from "@tsonic/target-api/source";
import { KindTypeReference } from "@tsonic/tsts/target-ast";

import type { TargetProgramIndex } from "../program-index.js";
import type { PointerTypedFactLedger } from "./flow-fact-ledger.js";
import type { PointerPlanningLedger } from "./planning-ledger.js";
import {
  PointerFlowGraph,
  type PointerFlowComponent,
  type PointerFlowVertex,
} from "./flow-graph.js";

export function collectPointerBindings(
  source: TargetSourceProgram,
  program: TargetProgramIndex,
  facts: PointerTypedFactLedger,
  graph: PointerFlowGraph,
  classifiedPointerTypes: Set<Node>,
  planning: PointerPlanningLedger,
): Set<Node> {
  const bindings = new Set<Node>();
  const candidates = program.nodesOfKind(KindTypeReference);
  for (const node of planning.candidates(
    "flow-census",
    "binding-type",
    candidates,
  )) {
    if (!source.ast.is.IsTypeReferenceNode(node)) {
      continue;
    }
    const fact = facts.pointerFactFor(node);
    if (fact === undefined) {
      continue;
    }
    const owner = directPointerTypeOwner(source, node, planning);
    if (owner === undefined) {
      continue;
    }
    const vertex = graph.add(owner);
    bindings.add(owner);
    recordPointerTypeFacts(
      source,
      facts,
      node,
      vertex,
      classifiedPointerTypes,
      planning,
    );
    const pointeeType = source.semantics.forNode(node)
      .types.authoredType(fact.pointee);
    if (pointeeType === undefined) {
      graph.block(vertex, "unsupported-pointee", fact.pointee);
    } else {
      vertex.pointees.set(pointeeType, fact.pointee);
    }
  }
  planning.assertCandidateCount("binding-type", candidates.length);
  return bindings;
}

export function recordPointerTypeFacts(
  source: TargetSourceProgram,
  facts: PointerTypedFactLedger,
  typeReference: Node,
  vertex: PointerFlowVertex,
  classifiedPointerTypes: Set<Node>,
  planning: PointerPlanningLedger,
): void {
  const typeName = source.ast.as.AsTypeReferenceNode(typeReference)?.TypeName;
  for (const node of new Set([typeReference, typeName].filter(isNode))) {
    planning.record("flow-census");
    if (facts.pointerFactFor(node) === undefined) {
      continue;
    }
    vertex.pointerTypes.add(node);
    classifiedPointerTypes.add(node);
  }
}

export function retainUnownedPointerTypes(
  source: TargetSourceProgram,
  facts: PointerTypedFactLedger,
  graph: PointerFlowGraph,
  classifiedPointerTypes: Set<Node>,
  planning: PointerPlanningLedger,
): void {
  for (const { node, fact } of planning.candidates(
    "flow-census",
    "unowned-type",
    facts.pointerTypeEntries,
  )) {
    if (classifiedPointerTypes.has(node)) {
      continue;
    }
    const vertex = graph.add(node);
    vertex.pointerTypes.add(node);
    classifiedPointerTypes.add(node);
    const pointeeType = source.semantics.forNode(node)
      .types.authoredType(fact.pointee);
    if (pointeeType === undefined) {
      graph.block(vertex, "unsupported-pointee", fact.pointee);
    } else {
      vertex.pointees.set(pointeeType, fact.pointee);
    }
    graph.block(vertex, "declaration-boundary", node);
  }
  planning.assertCandidateCount(
    "unowned-type",
    facts.pointerTypeEntries.length,
  );
}

export function assertPointerCensusTotality(
  components: readonly PointerFlowComponent[],
  operations: Iterable<Node>,
  pointerTypes: Iterable<Node>,
  planning?: PointerPlanningLedger,
): void {
  const classifiedOperations = new Set<Node>();
  const classifiedPointerTypes = new Set<Node>();
  for (const component of components) {
    planning?.record("flow-census");
    collectUnique(
      classifiedOperations,
      component.operations,
      "pointer operation belongs to multiple components",
      planning,
    );
    collectUnique(
      classifiedPointerTypes,
      component.pointerTypes,
      "pointer type belongs to multiple components",
      planning,
    );
  }
  assertExactJoin(
    classifiedOperations,
    operations,
    "pointer operation",
    planning,
  );
  assertExactJoin(
    classifiedPointerTypes,
    pointerTypes,
    "pointer type",
    planning,
  );
}

function directPointerTypeOwner(
  source: TargetSourceProgram,
  typeReference: Node,
  planning: PointerPlanningLedger,
): Node | undefined {
  let current = source.ast.parent(typeReference);
  while (current !== undefined && !source.ast.is.IsSourceFile(current)) {
    planning.record("flow-census");
    if (
      source.ast.is.IsVariableDeclaration(current) ||
      source.ast.is.IsParameterDeclaration(current)
    ) {
      return pointerTypeOwnsDeclaration(source, current, typeReference)
        ? current
        : undefined;
    }
    if (source.ast.typeNode(current) !== undefined) {
      return undefined;
    }
    current = source.ast.parent(current);
  }
  return undefined;
}

function pointerTypeOwnsDeclaration(
  source: TargetSourceProgram,
  declaration: Node,
  pointerTypeNode: Node,
): boolean {
  const declaredTypeNode = source.ast.typeNode(declaration);
  if (declaredTypeNode === pointerTypeNode) {
    return true;
  }
  if (declaredTypeNode === undefined) {
    return false;
  }
  const semantics = source.semantics.forNode(declaredTypeNode);
  const declaredType = semantics.types.authoredType(declaredTypeNode);
  const pointerType = semantics.types.authoredType(pointerTypeNode);
  if (
    declaredType === undefined ||
    pointerType === undefined ||
    !semantics.types.isUnion(declaredType)
  ) {
    return false;
  }
  const nonNullish = semantics.types.unionOrIntersectionTypes(declaredType)
    .filter((candidate) => !semantics.types.isNullish(candidate));
  const nonNullishType = nonNullish[0];
  return nonNullish.length === 1 &&
    nonNullishType !== undefined &&
    semantics.types.relationship(nonNullishType, pointerType) === "identical";
}

function collectUnique(
  target: Set<Node>,
  nodes: readonly Node[],
  duplicateMessage: string,
  planning?: PointerPlanningLedger,
): void {
  for (const node of nodes) {
    planning?.record("flow-census");
    if (target.has(node)) {
      throw new Error(duplicateMessage);
    }
    target.add(node);
  }
}

function assertExactJoin(
  classified: ReadonlySet<Node>,
  expectedValues: Iterable<Node>,
  subject: string,
  planning?: PointerPlanningLedger,
): void {
  const expected = new Set<Node>();
  for (const node of expectedValues) {
    planning?.record("flow-census");
    expected.add(node);
  }
  if (classified.size !== expected.size) {
    throw new Error(
      `classified ${classified.size} ${subject}s, expected ${expected.size}`,
    );
  }
  for (const node of expected) {
    planning?.record("flow-census");
    if (!classified.has(node)) {
      throw new Error(`${subject} is absent from the component denominator`);
    }
  }
}

function isNode(node: Node | undefined): node is Node {
  return node !== undefined;
}
