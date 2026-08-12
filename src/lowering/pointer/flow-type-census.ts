import { pointerFactKey } from "@tsonic/tsts";
import type { Node } from "@tsonic/tsts";
import type { TargetSourceProgram } from "@tsonic/target-api";
import { KindTypeReference } from "@tsonic/tsts/target-ast";

import type { TargetProgramIndex } from "../program-index.js";
import {
  PointerFlowGraph,
  type PointerFlowComponent,
  type PointerFlowVertex,
} from "./flow-graph.js";
import { validatePointerFact } from "./type-contract.js";

export function derivePointerTypeFactDenominator(
  source: TargetSourceProgram,
  program: TargetProgramIndex,
): ReadonlySet<Node> {
  const pointerTypes = new Set<Node>();
  for (const node of program.nodes) {
    const fact = source.sourceFacts.getFact(node, pointerFactKey);
    if (fact === undefined) {
      continue;
    }
    validatePointerFact(source, node, fact);
    pointerTypes.add(node);
  }
  return pointerTypes;
}

export function collectPointerBindings(
  source: TargetSourceProgram,
  program: TargetProgramIndex,
  graph: PointerFlowGraph,
  classifiedPointerTypes: Set<Node>,
): Set<Node> {
  const bindings = new Set<Node>();
  for (const node of program.nodesOfKind(KindTypeReference)) {
    if (!source.ast.is.IsTypeReferenceNode(node)) {
      continue;
    }
    const fact = source.sourceFacts.getFact(node, pointerFactKey);
    if (fact === undefined) {
      continue;
    }
    const owner = directPointerTypeOwner(source, node);
    if (owner === undefined) {
      continue;
    }
    const vertex = graph.add(owner);
    bindings.add(owner);
    recordPointerTypeFacts(source, node, vertex, classifiedPointerTypes);
    const pointeeType = source.semantics.forNode(node)
      .getTypeFromTypeNode(fact.pointee);
    if (pointeeType === undefined) {
      graph.block(vertex, "unsupported-pointee", fact.pointee);
    } else {
      vertex.pointees.set(pointeeType, fact.pointee);
    }
  }
  return bindings;
}

export function recordPointerTypeFacts(
  source: TargetSourceProgram,
  typeReference: Node,
  vertex: PointerFlowVertex,
  classifiedPointerTypes: Set<Node>,
): void {
  const typeName = source.ast.as.AsTypeReferenceNode(typeReference)?.TypeName;
  for (const node of new Set([typeReference, typeName].filter(isNode))) {
    if (source.sourceFacts.getFact(node, pointerFactKey) === undefined) {
      continue;
    }
    vertex.pointerTypes.add(node);
    classifiedPointerTypes.add(node);
  }
}

export function retainUnownedPointerTypes(
  source: TargetSourceProgram,
  program: TargetProgramIndex,
  graph: PointerFlowGraph,
  classifiedPointerTypes: Set<Node>,
): void {
  for (const node of program.nodes) {
    if (classifiedPointerTypes.has(node)) {
      continue;
    }
    const fact = source.sourceFacts.getFact(node, pointerFactKey);
    if (fact === undefined) {
      continue;
    }
    const vertex = graph.add(node);
    vertex.pointerTypes.add(node);
    classifiedPointerTypes.add(node);
    const pointeeType = source.semantics.forNode(node)
      .getTypeFromTypeNode(fact.pointee);
    if (pointeeType === undefined) {
      graph.block(vertex, "unsupported-pointee", fact.pointee);
    } else {
      vertex.pointees.set(pointeeType, fact.pointee);
    }
    graph.block(vertex, "declaration-boundary", node);
  }
}

export function assertPointerCensusTotality(
  components: readonly PointerFlowComponent[],
  operations: ReadonlySet<Node>,
  pointerTypes: ReadonlySet<Node>,
): void {
  const classifiedOperations = new Set<Node>();
  const classifiedPointerTypes = new Set<Node>();
  for (const component of components) {
    collectUnique(
      classifiedOperations,
      component.operations,
      "pointer operation belongs to multiple components",
    );
    collectUnique(
      classifiedPointerTypes,
      component.pointerTypes,
      "pointer type belongs to multiple components",
    );
  }
  assertExactJoin(
    classifiedOperations,
    operations,
    "pointer operation",
  );
  assertExactJoin(
    classifiedPointerTypes,
    pointerTypes,
    "pointer type",
  );
}

function directPointerTypeOwner(
  source: TargetSourceProgram,
  typeReference: Node,
): Node | undefined {
  let current = source.ast.parent(typeReference);
  while (current !== undefined && !source.ast.is.IsSourceFile(current)) {
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
  const declaredType = semantics.getTypeFromTypeNode(declaredTypeNode);
  const pointerType = semantics.getTypeFromTypeNode(pointerTypeNode);
  if (
    declaredType === undefined ||
    pointerType === undefined ||
    !semantics.isUnion(declaredType)
  ) {
    return false;
  }
  const nonNullish = semantics.getUnionOrIntersectionTypes(declaredType)
    .filter((candidate) => !semantics.isNullish(candidate));
  const nonNullishType = nonNullish[0];
  return nonNullish.length === 1 &&
    nonNullishType !== undefined &&
    semantics.getTypeRelationship(nonNullishType, pointerType) === "identical";
}

function collectUnique(
  target: Set<Node>,
  nodes: readonly Node[],
  duplicateMessage: string,
): void {
  for (const node of nodes) {
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
): void {
  const expected = new Set(expectedValues);
  if (classified.size !== expected.size) {
    throw new Error(
      `classified ${classified.size} ${subject}s, expected ${expected.size}`,
    );
  }
  for (const node of expected) {
    if (!classified.has(node)) {
      throw new Error(`${subject} is absent from the component denominator`);
    }
  }
}

function isNode(node: Node | undefined): node is Node {
  return node !== undefined;
}
