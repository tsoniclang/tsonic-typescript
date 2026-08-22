import type { Node } from "@tsonic/tsts";
import type { TargetSourceProgram } from "@tsonic/target-api/source";
import { KindVariableDeclaration } from "@tsonic/tsts/target-ast";

import type { TargetProgramIndex } from "../../../../program-index.js";
import { isTransparentParent } from "../../callable/input-reference.js";
import { exactBindingWriteInput } from "../../storage/assignment.js";
import {
  isFunctionLike,
  transparentExpression,
} from "../../../model/syntax.js";

export interface ReturnLocalTopology {
  readIsAdmitted(reference: Node): boolean;
}

export function createReturnLocalTopology(
  source: TargetSourceProgram,
  program: TargetProgramIndex,
): ReturnLocalTopology {
  const owners = new Map<Node, Node>();
  const neighbors = new Map<Node, Set<Node>>();
  for (const declaration of program.nodesOfKind(KindVariableDeclaration)) {
    const owner = containingLocalScope(source, declaration);
    if (
      owner === undefined ||
      !source.ast.is.IsIdentifier(source.ast.name(declaration))
    ) {
      continue;
    }
    owners.set(declaration, owner);
    neighbors.set(declaration, new Set());
  }
  connectIdentityBindings(source, program, owners, neighbors);
  const components = indexComponents(neighbors);
  const admitted = new Set<Node>();
  const rejected = new Set<number>();
  for (const [declaration, owner] of owners) {
    const component = components.get(declaration);
    if (component === undefined) {
      continue;
    }
    const writes = new Set(
      program.bindingWritesFor(declaration).map((write) => write.reference),
    );
    for (const reference of source.navigation.referencesToDeclaration(declaration)) {
      if (writes.has(reference)) {
        continue;
      }
      if (
        containingLocalScope(source, reference) === owner &&
        referenceIsAdmitted(source, program, reference, component, components)
      ) {
        admitted.add(reference);
      } else {
        rejected.add(component);
      }
    }
  }
  return Object.freeze({
    readIsAdmitted(reference: Node): boolean {
      const declaration = source.navigation.sourceReferenceFor(reference)?.declaration;
      const component = declaration === undefined
        ? undefined
        : components.get(declaration);
      return component !== undefined &&
        !rejected.has(component) &&
        admitted.has(reference);
    },
  });
}

function connectIdentityBindings(
  source: TargetSourceProgram,
  program: TargetProgramIndex,
  owners: ReadonlyMap<Node, Node>,
  neighbors: ReadonlyMap<Node, Set<Node>>,
): void {
  for (const [destination, owner] of owners) {
    const declaration = source.ast.as.AsVariableDeclaration(destination);
    const inputs: Node[] = declaration?.Initializer === undefined
      ? []
      : [declaration.Initializer];
    for (const write of program.bindingWritesFor(destination)) {
      const input = exactBindingWriteInput(source, write);
      if (input !== undefined) {
        inputs.push(input);
      }
    }
    for (const input of inputs) {
      for (const reference of directIdentityReferences(source, input)) {
        const selected = source.navigation.sourceReferenceFor(reference)?.declaration;
        if (selected === undefined || owners.get(selected) !== owner) {
          continue;
        }
        neighbors.get(destination)?.add(selected);
        neighbors.get(selected)?.add(destination);
      }
    }
  }
}

function indexComponents(
  neighbors: ReadonlyMap<Node, ReadonlySet<Node>>,
): ReadonlyMap<Node, number> {
  const result = new Map<Node, number>();
  let nextComponent = 0;
  for (const declaration of neighbors.keys()) {
    if (result.has(declaration)) {
      continue;
    }
    const component = nextComponent;
    nextComponent += 1;
    const pending = [declaration];
    while (pending.length !== 0) {
      const member = pending.pop();
      if (member === undefined || result.has(member)) {
        continue;
      }
      result.set(member, component);
      pending.push(...neighbors.get(member) ?? []);
    }
  }
  return result;
}

function referenceIsAdmitted(
  source: TargetSourceProgram,
  program: TargetProgramIndex,
  reference: Node,
  component: number,
  components: ReadonlyMap<Node, number>,
): boolean {
  return referenceIsAwaited(source, reference) ||
    referenceIsReturned(source, reference) ||
    identityDestinationComponent(source, program, reference, components) ===
      component ||
    awaitedReplacementComponent(source, program, reference, components) ===
      component ||
    isNullishIdentityObservation(source, reference);
}

function referenceIsAwaited(
  source: TargetSourceProgram,
  reference: Node,
): boolean {
  let current = reference;
  for (;;) {
    const parent = source.ast.parent(current);
    if (parent === undefined) {
      return false;
    }
    if (isTransparentParent(source, parent, current)) {
      current = parent;
      continue;
    }
    return source.ast.is.IsAwaitExpression(parent) &&
      source.ast.as.AsAwaitExpression(parent)?.Expression === current;
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

function referenceIsReturned(
  source: TargetSourceProgram,
  reference: Node,
): boolean {
  let current = reference;
  for (;;) {
    const parent = source.ast.parent(current);
    if (parent === undefined) {
      return false;
    }
    if (
      isTransparentParent(source, parent, current) ||
      isConditionalBranch(source, parent, current) ||
      isArrayElement(source, parent, current)
    ) {
      current = parent;
      continue;
    }
    if (source.ast.is.IsReturnStatement(parent)) {
      return source.ast.as.AsReturnStatement(parent)?.Expression === current;
    }
    return source.ast.is.IsArrowFunction(parent) &&
      source.ast.body(parent) === current;
  }
}

function identityDestinationComponent(
  source: TargetSourceProgram,
  program: TargetProgramIndex,
  reference: Node,
  components: ReadonlyMap<Node, number>,
): number | undefined {
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
      return source.ast.as.AsVariableDeclaration(parent)?.Initializer === current
        ? components.get(parent)
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
    return declaration === undefined ? undefined : components.get(declaration);
  }
}

function awaitedReplacementComponent(
  source: TargetSourceProgram,
  program: TargetProgramIndex,
  reference: Node,
  components: ReadonlyMap<Node, number>,
): number | undefined {
  let current = reference;
  for (;;) {
    const parent = source.ast.parent(current);
    if (parent === undefined || isFunctionLike(source, parent)) {
      return undefined;
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
    const declaration = destination !== undefined &&
        source.ast.is.IsIdentifier(destination)
      ? source.navigation.sourceReferenceFor(destination)?.declaration
      : undefined;
    const value = transparentExpression(source, binary?.Right);
    return declaration !== undefined &&
        value !== undefined &&
        source.ast.is.IsAwaitExpression(value)
      ? components.get(declaration)
      : undefined;
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

function isArrayElement(
  source: TargetSourceProgram,
  parent: Node,
  child: Node,
): boolean {
  return source.ast.is.IsArrayLiteralExpression(parent) &&
    source.ast.elements(parent).includes(child);
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
      const type = semantics.types.expressionType(other);
      return type !== undefined && semantics.types.isNullish(type);
    }
    if (!isTransparentParent(source, parent, current)) {
      return false;
    }
    current = parent;
  }
}

function containingLocalScope(
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
  return source.ast.getSourceFile(node);
}
