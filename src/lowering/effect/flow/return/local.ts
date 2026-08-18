import type { Node } from "@tsonic/tsts";
import type { TargetSourceProgram } from "@tsonic/target-api";
import {
  KindReturnStatement,
} from "@tsonic/tsts/target-ast";

import type { TargetProgramIndex } from "../../../program-index.js";

import { isTransparentParent } from "../callable/input-reference.js";
import {
  isFunctionLike,
  transparentExpression,
} from "../../model/syntax.js";

export interface ReturnLocalBinding {
  readonly declaration: Node;
  readonly inputs: readonly Node[];
}

export interface ReturnLocalFlow {
  bindingFor(identifier: Node): ReturnLocalBinding | undefined;
}

interface MutableReturnBinding {
  readonly declaration: Node;
  readonly owner: Node;
  readonly returnedReferences: Set<Node>;
  readonly inputs: Node[];
  readonly assignmentOperations: Set<Node>;
  readonly identityNeighbors: Set<Node>;
  closed: boolean;
}

export function createReturnLocalFlow(
  source: TargetSourceProgram,
  program: TargetProgramIndex,
): ReturnLocalFlow {
  const roots = collectReturnRoots(source, program);
  const ownerNodes = collectOwnerNodes(source, roots);
  const candidates = collectOwnerBindings(source, ownerNodes, roots);
  collectBindingInputs(source, candidates, ownerNodes);
  connectIdentityBindings(source, candidates);
  const selected = selectIdentityComponents(roots, candidates);
  const components = indexIdentityComponents(selected);
  auditBindingUses(source, selected, components, ownerNodes);
  closeRejectedComponents(selected, components);
  return Object.freeze({
    bindingFor(identifier: Node): ReturnLocalBinding | undefined {
      const declaration = source.navigation.sourceReferenceFor(identifier)?.declaration;
      const binding = declaration === undefined ? undefined : selected.get(declaration);
      return binding?.closed === true ? binding : undefined;
    },
  });
}

function collectReturnRoots(
  source: TargetSourceProgram,
  program: TargetProgramIndex,
): ReadonlyMap<Node, MutableReturnBinding> {
  const roots = new Map<Node, MutableReturnBinding>();
  for (const node of program.nodesOfKind(KindReturnStatement)) {
    const expression = source.ast.as.AsReturnStatement(node)?.Expression;
    for (const reference of directReturnReferences(source, expression)) {
      const declaration = source.navigation.sourceReferenceFor(reference)?.declaration;
      const owner = declaration === undefined
        ? undefined
        : containingFunction(source, declaration);
      if (
        declaration === undefined ||
        owner === undefined ||
        owner !== containingFunction(source, node) ||
        !source.ast.is.IsVariableDeclaration(declaration) ||
        !source.ast.is.IsIdentifier(source.ast.name(declaration))
      ) {
        continue;
      }
      const existing = roots.get(declaration);
      if (existing !== undefined) {
        existing.returnedReferences.add(reference);
        continue;
      }
      roots.set(declaration, createBinding(source, declaration, owner, reference));
    }
  }
  return roots;
}

function collectOwnerBindings(
  source: TargetSourceProgram,
  nodes: readonly Node[],
  roots: ReadonlyMap<Node, MutableReturnBinding>,
): ReadonlyMap<Node, MutableReturnBinding> {
  const result = new Map(roots);
  const owners = new Set([...roots.values()].map((binding) => binding.owner));
  for (const node of nodes) {
    if (
      result.has(node) ||
      !source.ast.is.IsVariableDeclaration(node) ||
      !source.ast.is.IsIdentifier(source.ast.name(node))
    ) {
      continue;
    }
    const owner = containingFunction(source, node);
    if (owner !== undefined && owners.has(owner)) {
      result.set(node, createBinding(source, node, owner));
    }
  }
  return result;
}

function createBinding(
  source: TargetSourceProgram,
  declaration: Node,
  owner: Node,
  returnedReference?: Node,
): MutableReturnBinding {
  const initializer = source.ast.as.AsVariableDeclaration(declaration)?.Initializer;
  return {
    declaration,
    owner,
    returnedReferences: new Set(
      returnedReference === undefined ? [] : [returnedReference],
    ),
    inputs: initializer === undefined ? [] : [initializer],
    assignmentOperations: new Set(),
    identityNeighbors: new Set(),
    closed: true,
  };
}

function collectBindingInputs(
  source: TargetSourceProgram,
  bindings: ReadonlyMap<Node, MutableReturnBinding>,
  nodes: readonly Node[],
): void {
  for (const node of nodes) {
    if (!source.ast.is.IsIdentifier(node)) {
      continue;
    }
    const declaration = source.navigation.sourceReferenceFor(node)?.declaration;
    const binding = declaration === undefined ? undefined : bindings.get(declaration);
    const assignment = binding === undefined
      ? undefined
      : directAssignmentAtReference(source, node);
    if (
      binding === undefined ||
      assignment === undefined ||
      binding.assignmentOperations.has(assignment.operation)
    ) {
      continue;
    }
    binding.assignmentOperations.add(assignment.operation);
    if (!isReferenceTo(source, assignment.value, binding.declaration)) {
      binding.inputs.push(assignment.value);
    }
  }
}

function connectIdentityBindings(
  source: TargetSourceProgram,
  bindings: ReadonlyMap<Node, MutableReturnBinding>,
): void {
  for (const destination of bindings.values()) {
    for (const input of destination.inputs) {
      for (const reference of directIdentityReferences(source, input)) {
        const declaration = source.navigation.sourceReferenceFor(reference)?.declaration;
        const sourceBinding = declaration === undefined
          ? undefined
          : bindings.get(declaration);
        if (sourceBinding?.owner !== destination.owner) {
          continue;
        }
        destination.identityNeighbors.add(sourceBinding.declaration);
        sourceBinding.identityNeighbors.add(destination.declaration);
      }
    }
  }
}

function selectIdentityComponents(
  roots: ReadonlyMap<Node, MutableReturnBinding>,
  candidates: ReadonlyMap<Node, MutableReturnBinding>,
): ReadonlyMap<Node, MutableReturnBinding> {
  const selected = new Map<Node, MutableReturnBinding>();
  const pending = [...roots.keys()];
  while (pending.length !== 0) {
    const declaration = pending.pop();
    if (declaration === undefined || selected.has(declaration)) {
      continue;
    }
    const binding = candidates.get(declaration);
    if (binding === undefined) {
      continue;
    }
    selected.set(declaration, binding);
    pending.push(...binding.identityNeighbors);
  }
  return selected;
}

function indexIdentityComponents(
  bindings: ReadonlyMap<Node, MutableReturnBinding>,
): ReadonlyMap<Node, Node> {
  const result = new Map<Node, Node>();
  for (const declaration of bindings.keys()) {
    if (result.has(declaration)) {
      continue;
    }
    const pending = [declaration];
    while (pending.length !== 0) {
      const member = pending.pop();
      if (member === undefined || result.has(member) || !bindings.has(member)) {
        continue;
      }
      result.set(member, declaration);
      pending.push(...bindings.get(member)?.identityNeighbors ?? []);
    }
  }
  return result;
}

function auditBindingUses(
  source: TargetSourceProgram,
  bindings: ReadonlyMap<Node, MutableReturnBinding>,
  components: ReadonlyMap<Node, Node>,
  nodes: readonly Node[],
): void {
  for (const node of nodes) {
    if (!source.ast.is.IsIdentifier(node)) {
      continue;
    }
    const declaration = source.navigation.sourceReferenceFor(node)?.declaration;
    const binding = declaration === undefined ? undefined : bindings.get(declaration);
    if (
      binding === undefined ||
      node === source.ast.name(binding.declaration) ||
      directAssignmentAtReference(source, node) !== undefined ||
      binding.returnedReferences.has(node) ||
      directIdentityDestination(source, node, bindings) !== undefined ||
      isAwaitedComponentReplacement(
        source,
        node,
        binding.declaration,
        components,
      ) ||
      isNullishIdentityObservation(source, node)
    ) {
      continue;
    }
    binding.closed = false;
  }
}

function closeRejectedComponents(
  bindings: ReadonlyMap<Node, MutableReturnBinding>,
  components: ReadonlyMap<Node, Node>,
): void {
  const rejected = new Set<Node>();
  for (const binding of bindings.values()) {
    const component = components.get(binding.declaration);
    if (!binding.closed && component !== undefined) {
      rejected.add(component);
    }
  }
  for (const binding of bindings.values()) {
    const component = components.get(binding.declaration);
    if (component !== undefined && rejected.has(component)) {
      binding.closed = false;
    }
  }
}

function directIdentityReferences(
  source: TargetSourceProgram,
  expression: Node,
): readonly Node[] {
  const root = transparentExpression(source, expression);
  if (root === undefined) {
    return [];
  }
  if (source.ast.is.IsIdentifier(root)) {
    return [root];
  }
  if (!source.ast.is.IsConditionalExpression(root)) {
    return [];
  }
  const conditional = source.ast.as.AsConditionalExpression(root);
  return [conditional?.WhenTrue, conditional?.WhenFalse].flatMap((branch) =>
    branch === undefined ? [] : directIdentityReferences(source, branch)
  );
}

function directIdentityDestination(
  source: TargetSourceProgram,
  reference: Node,
  bindings: ReadonlyMap<Node, MutableReturnBinding>,
): Node | undefined {
  let current = reference;
  for (;;) {
    const parent = source.ast.parent(current);
    if (parent === undefined) {
      return undefined;
    }
    if (
      isTransparentParent(source, parent, current) ||
      isConditionalBranch(source, parent, current)
    ) {
      current = parent;
      continue;
    }
    if (source.ast.is.IsVariableDeclaration(parent)) {
      return source.ast.as.AsVariableDeclaration(parent)?.Initializer === current &&
          bindings.has(parent)
        ? parent
        : undefined;
    }
    if (!source.ast.is.IsBinaryExpression(parent)) {
      return undefined;
    }
    const binary = source.ast.as.AsBinaryExpression(parent);
    const destination = binary?.Right === current &&
        source.ast.operatorKindName(parent) === "KindEqualsToken"
      ? transparentExpression(source, binary.Left)
      : undefined;
    const declaration = destination !== undefined &&
        source.ast.is.IsIdentifier(destination)
      ? source.navigation.sourceReferenceFor(destination)?.declaration
      : undefined;
    return declaration !== undefined && bindings.has(declaration)
      ? declaration
      : undefined;
  }
}

function isAwaitedComponentReplacement(
  source: TargetSourceProgram,
  reference: Node,
  declaration: Node,
  components: ReadonlyMap<Node, Node>,
): boolean {
  let current = reference;
  for (;;) {
    const parent = source.ast.parent(current);
    if (parent === undefined || isFunctionLike(source, parent)) {
      return false;
    }
    if (!source.ast.is.IsBinaryExpression(parent)) {
      current = parent;
      continue;
    }
    const binary = source.ast.as.AsBinaryExpression(parent);
    const destination = binary?.Right === current &&
        source.ast.operatorKindName(parent) === "KindEqualsToken"
      ? transparentExpression(source, binary.Left)
      : undefined;
    const destinationDeclaration = destination !== undefined &&
        source.ast.is.IsIdentifier(destination)
      ? source.navigation.sourceReferenceFor(destination)?.declaration
      : undefined;
    const value = transparentExpression(source, binary?.Right);
    return destinationDeclaration !== undefined &&
      components.get(destinationDeclaration) === components.get(declaration) &&
      value !== undefined &&
      source.ast.is.IsAwaitExpression(value);
  }
}

function isConditionalBranch(
  source: TargetSourceProgram,
  parent: Node,
  child: Node,
): boolean {
  if (!source.ast.is.IsConditionalExpression(parent)) {
    return false;
  }
  const conditional = source.ast.as.AsConditionalExpression(parent);
  return conditional?.WhenTrue === child || conditional?.WhenFalse === child;
}

function collectOwnerNodes(
  source: TargetSourceProgram,
  bindings: ReadonlyMap<Node, MutableReturnBinding>,
): readonly Node[] {
  const result = new Set<Node>();
  const pending = [...new Set(
    [...bindings.values()].map((binding) => binding.owner),
  )];
  while (pending.length !== 0) {
    const node = pending.pop();
    if (node === undefined || result.has(node)) {
      continue;
    }
    result.add(node);
    for (const child of source.ast.children(node)) {
      if (child !== undefined) {
        pending.push(child);
      }
    }
  }
  return [...result];
}

function directReturnReferences(
  source: TargetSourceProgram,
  expression: Node | undefined,
): readonly Node[] {
  const root = transparentExpression(source, expression);
  if (root === undefined) {
    return [];
  }
  if (source.ast.is.IsIdentifier(root)) {
    return [root];
  }
  if (source.ast.is.IsArrayLiteralExpression(root)) {
    return source.ast.elements(root).flatMap((element) =>
      element === undefined || source.ast.is.IsSpreadElement(element)
        ? []
        : directReturnReferences(source, element)
    );
  }
  if (!source.ast.is.IsConditionalExpression(root)) {
    return [];
  }
  const conditional = source.ast.as.AsConditionalExpression(root);
  return [
    ...directReturnReferences(source, conditional?.WhenTrue),
    ...directReturnReferences(source, conditional?.WhenFalse),
  ];
}

function directAssignmentAtReference(
  source: TargetSourceProgram,
  reference: Node,
): { readonly operation: Node; readonly value: Node } | undefined {
  let current = reference;
  for (;;) {
    const parent = source.ast.parent(current);
    if (parent === undefined) {
      return undefined;
    }
    if (source.ast.is.IsBinaryExpression(parent)) {
      const binary = source.ast.as.AsBinaryExpression(parent);
      return binary?.Left === current &&
          binary.Right !== undefined &&
          source.ast.operatorKindName(parent) === "KindEqualsToken"
        ? { operation: parent, value: binary.Right }
        : undefined;
    }
    if (!isTransparentParent(source, parent, current)) {
      return undefined;
    }
    current = parent;
  }
}

function isNullishIdentityObservation(
  source: TargetSourceProgram,
  reference: Node,
): boolean {
  let current = reference;
  for (;;) {
    const parent = source.ast.parent(current);
    if (parent === undefined) {
      return false;
    }
    if (source.ast.is.IsBinaryExpression(parent)) {
      if (!new Set([
        "KindEqualsEqualsEqualsToken",
        "KindExclamationEqualsEqualsToken",
      ]).has(source.ast.operatorKindName(parent) ?? "")) {
        return false;
      }
      const binary = source.ast.as.AsBinaryExpression(parent);
      const other = binary?.Left === current
        ? binary.Right
        : binary?.Right === current
        ? binary.Left
        : undefined;
      if (other === undefined) {
        return false;
      }
      const semantics = source.semantics.forNode(other);
      const type = semantics.getTypeAtLocation(other);
      return type !== undefined && semantics.isNullish(type);
    }
    if (!isTransparentParent(source, parent, current)) {
      return false;
    }
    current = parent;
  }
}

function isReferenceTo(
  source: TargetSourceProgram,
  expression: Node | undefined,
  declaration: Node,
): boolean {
  const root = transparentExpression(source, expression);
  return root !== undefined &&
    source.ast.is.IsIdentifier(root) &&
    source.navigation.sourceReferenceFor(root)?.declaration === declaration;
}

function containingFunction(
  source: TargetSourceProgram,
  node: Node,
): Node | undefined {
  let current = source.ast.parent(node);
  while (current !== undefined) {
    if (isFunctionLike(source, current)) {
      return current;
    }
    current = source.ast.parent(current);
  }
  return undefined;
}
