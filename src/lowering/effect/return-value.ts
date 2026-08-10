import type { Node } from "@tsonic/tsts";
import type { TargetSourceProgram } from "@tsonic/target-api";

import {
  forEachProgramNode,
  isFunctionLike,
  transparentExpression,
} from "./syntax.js";
import { typeExposesCallableThen } from "./synchronous.js";

export interface ReturnValueFlow {
  isDefinitelyNonThenable(expression: Node): boolean;
}

interface MutableReturnBinding {
  readonly declaration: Node;
  readonly owner: Node;
  readonly returnedReferences: Set<Node>;
  readonly inputs: Node[];
  readonly assignmentOperations: Set<Node>;
  closed: boolean;
}

export function createReturnValueFlow(
  source: TargetSourceProgram,
): ReturnValueFlow {
  const bindings = collectReturnBindings(source);
  auditReturnBindings(source, bindings);
  const results = new Map<Node, boolean>();
  return Object.freeze({
    isDefinitelyNonThenable(expression: Node): boolean {
      return expressionIsDefinitelyNonThenableWithin(
        source,
        expression,
        bindings,
        results,
        new Set(),
      );
    },
  });
}

export function expressionIsDefinitelyNonThenable(
  source: TargetSourceProgram,
  expression: Node,
): boolean {
  const root = transparentExpression(source, expression);
  if (root === undefined) {
    return false;
  }
  if (source.ast.is.IsAwaitExpression(root)) {
    return true;
  }
  const semantics = source.semantics.forNode(root);
  const type = semantics.getTypeAtLocation(root);
  if (
    type === undefined ||
    typeExposesCallableThen(semantics, type)
  ) {
    return false;
  }
  if (source.ast.is.IsArrayLiteralExpression(root)) {
    return true;
  }
  if (source.ast.is.IsObjectLiteralExpression(root)) {
    return objectLiteralIsDefinitelyNonThenable(source, root);
  }
  return semantics.isNever(type) ||
      semantics.isVoidLike(type) ||
      semantics.isNullish(type) ||
      semantics.isStringLike(type) ||
      semantics.isNumberLike(type) ||
      semantics.isBooleanLike(type) ||
      semantics.isBigIntLike(type);
}

function expressionIsDefinitelyNonThenableWithin(
  source: TargetSourceProgram,
  expression: Node,
  bindings: ReadonlyMap<Node, MutableReturnBinding>,
  results: Map<Node, boolean>,
  pending: Set<Node>,
): boolean {
  if (expressionIsDefinitelyNonThenable(source, expression)) {
    return true;
  }
  const root = transparentExpression(source, expression);
  if (root === undefined) {
    return false;
  }
  if (source.ast.is.IsConditionalExpression(root)) {
    const conditional = source.ast.as.AsConditionalExpression(root);
    return conditional?.WhenTrue !== undefined &&
      conditional.WhenFalse !== undefined &&
      expressionIsDefinitelyNonThenableWithin(
        source,
        conditional.WhenTrue,
        bindings,
        results,
        pending,
      ) &&
      expressionIsDefinitelyNonThenableWithin(
        source,
        conditional.WhenFalse,
        bindings,
        results,
        pending,
      );
  }
  if (!source.ast.is.IsIdentifier(root)) {
    return false;
  }
  const declaration = source.navigation.sourceReferenceFor(root)?.declaration;
  const binding = declaration === undefined ? undefined : bindings.get(declaration);
  if (binding === undefined || !binding.closed) {
    return false;
  }
  const existing = results.get(binding.declaration);
  if (existing !== undefined) {
    return existing;
  }
  if (pending.has(binding.declaration)) {
    return false;
  }
  pending.add(binding.declaration);
  const result = binding.inputs.every((input) =>
    expressionIsDefinitelyNonThenableWithin(
      source,
      input,
      bindings,
      results,
      pending,
    )
  );
  pending.delete(binding.declaration);
  results.set(binding.declaration, result);
  return result;
}

function collectReturnBindings(
  source: TargetSourceProgram,
): ReadonlyMap<Node, MutableReturnBinding> {
  const bindings = new Map<Node, MutableReturnBinding>();
  forEachProgramNode(source, (node) => {
    if (!source.ast.is.IsReturnStatement(node)) {
      return;
    }
    const expression = source.ast.as.AsReturnStatement(node)?.Expression;
    for (const referenceNode of directReturnReferences(source, expression)) {
      const declaration = source.navigation.sourceReferenceFor(referenceNode)
        ?.declaration;
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
      const existing = bindings.get(declaration);
      if (existing === undefined) {
        const initializer = source.ast.as.AsVariableDeclaration(declaration)
          ?.Initializer;
        bindings.set(declaration, {
          declaration,
          owner,
          returnedReferences: new Set([referenceNode]),
          inputs: initializer === undefined ? [] : [initializer],
          assignmentOperations: new Set(),
          closed: true,
        });
      } else {
        existing.returnedReferences.add(referenceNode);
      }
    }
  });
  return bindings;
}

function auditReturnBindings(
  source: TargetSourceProgram,
  bindings: ReadonlyMap<Node, MutableReturnBinding>,
): void {
  const byOwner = new Map<Node, Map<Node, MutableReturnBinding>>();
  for (const binding of bindings.values()) {
    const owned = byOwner.get(binding.owner);
    if (owned === undefined) {
      byOwner.set(binding.owner, new Map([[binding.declaration, binding]]));
    } else {
      owned.set(binding.declaration, binding);
    }
  }
  for (const [owner, owned] of byOwner) {
    forEachNode(source, owner, (node) => {
      if (!source.ast.is.IsIdentifier(node)) {
        return;
      }
      const declaration = source.navigation.sourceReferenceFor(node)?.declaration;
      const binding = declaration === undefined ? undefined : owned.get(declaration);
      if (binding === undefined || node === source.ast.name(declaration)) {
        return;
      }
      const assignment = directAssignmentAtReference(source, node);
      if (assignment !== undefined) {
        if (!binding.assignmentOperations.has(assignment.operation)) {
          binding.assignmentOperations.add(assignment.operation);
          if (!isReferenceTo(source, assignment.value, binding.declaration)) {
            binding.inputs.push(assignment.value);
          }
        }
        return;
      }
      if (
        binding.returnedReferences.has(node) ||
        isSelfAssignmentValue(source, node, binding.declaration) ||
        isAwaitedSelfAssignmentInput(source, node, binding.declaration) ||
        isNullishIdentityObservation(source, node)
      ) {
        return;
      }
      binding.closed = false;
    });
  }
}

function isAwaitedSelfAssignmentInput(
  source: TargetSourceProgram,
  reference: Node,
  declaration: Node,
): boolean {
  let current = reference;
  for (;;) {
    const parent = source.ast.parent(current);
    if (parent === undefined || isFunctionLike(source, parent)) {
      return false;
    }
    if (source.ast.is.IsBinaryExpression(parent)) {
      const binary = source.ast.as.AsBinaryExpression(parent);
      if (
        binary?.Right !== current ||
        source.ast.operatorKindName(parent) !== "KindEqualsToken" ||
        !isReferenceTo(source, binary.Left, declaration)
      ) {
        return false;
      }
      const value = transparentExpression(source, binary.Right);
      return value !== undefined && source.ast.is.IsAwaitExpression(value);
    }
    current = parent;
  }
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
    const child = transparentChild(source, parent);
    if (child !== current) {
      return undefined;
    }
    current = parent;
  }
}

function isSelfAssignmentValue(
  source: TargetSourceProgram,
  reference: Node,
  declaration: Node,
): boolean {
  let current = reference;
  for (;;) {
    const parent = source.ast.parent(current);
    if (parent === undefined) {
      return false;
    }
    if (source.ast.is.IsBinaryExpression(parent)) {
      const binary = source.ast.as.AsBinaryExpression(parent);
      return binary?.Right === current &&
        source.ast.operatorKindName(parent) === "KindEqualsToken" &&
        isReferenceTo(source, binary.Left, declaration);
    }
    const child = transparentChild(source, parent);
    if (child !== current) {
      return false;
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
    const child = transparentChild(source, parent);
    if (child !== current) {
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

function forEachNode(
  source: TargetSourceProgram,
  root: Node,
  callback: (node: Node) => void,
): void {
  const pending = [root];
  while (pending.length > 0) {
    const node = pending.pop();
    if (node === undefined) {
      continue;
    }
    callback(node);
    const children = source.ast.children(node);
    for (let index = children.length - 1; index >= 0; index -= 1) {
      const child = children[index];
      if (child !== undefined) {
        pending.push(child);
      }
    }
  }
}

function transparentChild(
  source: TargetSourceProgram,
  node: Node,
): Node | undefined {
  if (source.ast.is.IsParenthesizedExpression(node)) {
    return source.ast.as.AsParenthesizedExpression(node)?.Expression;
  }
  if (source.ast.is.IsAsExpression(node)) {
    return source.ast.as.AsAsExpression(node)?.Expression;
  }
  if (source.ast.is.IsTypeAssertion(node)) {
    return source.ast.as.AsTypeAssertion(node)?.Expression;
  }
  if (source.ast.is.IsSatisfiesExpression(node)) {
    return source.ast.as.AsSatisfiesExpression(node)?.Expression;
  }
  return source.ast.is.IsNonNullExpression(node)
    ? source.ast.as.AsNonNullExpression(node)?.Expression
    : undefined;
}

function objectLiteralIsDefinitelyNonThenable(
  source: TargetSourceProgram,
  expression: Node,
): boolean {
  const properties = source.ast.as.AsObjectLiteralExpression(expression)
    ?.Properties?.Nodes;
  return properties !== undefined && properties.every((property) => {
    if (property === undefined || source.ast.is.IsSpreadAssignment(property)) {
      return false;
    }
    const name = source.ast.name(property);
    if (name === undefined || source.ast.is.IsComputedPropertyName(name)) {
      return false;
    }
    const text = source.ast.text(name);
    return text !== "then" && text !== "__proto__";
  });
}
