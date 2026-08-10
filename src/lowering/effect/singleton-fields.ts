import type { Node } from "@tsonic/tsts";
import type { TargetSourceProgram } from "@tsonic/target-api";

import { callableDeclarationAllowsSynchronousValue } from "./callable-contract.js";
import {
  declarationForSymbols,
  indexDeclarationSymbols,
  isTransparentParent,
} from "./callable-input-reference.js";
import {
  isFunctionLike,
  isModuleForwardingReference,
} from "./syntax.js";

interface SingletonClass {
  readonly declaration: Node;
  readonly members: ReadonlySet<Node>;
  readonly fields: ReadonlySet<Node>;
  instance?: Node;
  closed: boolean;
}

export function collectClosedSingletonCallableFields(
  source: TargetSourceProgram,
  nodes: readonly Node[],
): ReadonlySet<Node> {
  const classes = collectDataClasses(source, nodes);
  collectSingletonInstances(source, nodes, classes);
  auditClassReferences(source, nodes, classes);
  auditInstanceReferences(source, nodes, classes);
  return new Set([...classes.values()].flatMap((candidate) =>
    candidate.closed && candidate.instance !== undefined
      ? [...candidate.fields]
      : []
  ));
}

function collectDataClasses(
  source: TargetSourceProgram,
  nodes: readonly Node[],
): Map<Node, SingletonClass> {
  const classes = new Map<Node, SingletonClass>();
  for (const node of nodes) {
    if (
      !source.ast.is.IsClassDeclaration(node) ||
      source.ast.extendsHeritageElements(node).length !== 0 ||
      source.ast.hasModifierKind(node, "abstract") ||
      source.ast.hasModifierKind(node, "ambient") ||
      hasDecorator(source, node)
    ) {
      continue;
    }
    const fields = new Set<Node>();
    const members = new Set<Node>();
    let valid = true;
    for (const member of source.ast.members(node)) {
      if (member === undefined || hasDecorator(source, member)) {
        valid = false;
        break;
      }
      if (source.ast.is.IsConstructorDeclaration(member)) {
        const body = source.ast.body(member);
        if (
          body === undefined ||
          source.ast.parameters(member).length !== 0 ||
          source.ast.statements(body).length !== 0
        ) {
          valid = false;
          break;
        }
        continue;
      }
      if (
        !source.ast.is.IsPropertyDeclaration(member) ||
        source.ast.hasModifierKind(member, "static") ||
        source.ast.is.IsComputedPropertyName(source.ast.name(member))
      ) {
        valid = false;
        break;
      }
      members.add(member);
      if (callableDeclarationAllowsSynchronousValue(source, member)) {
        fields.add(member);
      }
    }
    if (valid && fields.size !== 0) {
      classes.set(node, {
        declaration: node,
        members,
        fields,
        closed: true,
      });
    }
  }
  return classes;
}

function collectSingletonInstances(
  source: TargetSourceProgram,
  nodes: readonly Node[],
  classes: ReadonlyMap<Node, SingletonClass>,
): void {
  for (const node of nodes) {
    if (
      !source.ast.is.IsVariableDeclaration(node) ||
      source.ast.variableDeclarationKind(node) !== "const" ||
      !source.ast.is.IsIdentifier(source.ast.name(node)) ||
      containingFunction(source, node) !== undefined
    ) {
      continue;
    }
    const initializer = source.ast.as.AsVariableDeclaration(node)?.Initializer;
    if (initializer === undefined || !source.ast.is.IsNewExpression(initializer)) {
      continue;
    }
    const expression = source.ast.as.AsNewExpression(initializer)?.Expression;
    const declaration = expression === undefined
      ? undefined
      : source.navigation.sourceReferenceFor(expression)?.declaration;
    const candidate = declaration === undefined ? undefined : classes.get(declaration);
    if (
      candidate === undefined ||
      source.ast.arguments(initializer).length !== 0 ||
      candidate.instance !== undefined
    ) {
      if (candidate !== undefined) {
        candidate.closed = false;
      }
      continue;
    }
    candidate.instance = node;
  }
}

function auditClassReferences(
  source: TargetSourceProgram,
  nodes: readonly Node[],
  classes: ReadonlyMap<Node, SingletonClass>,
): void {
  const symbols = indexDeclarationSymbols(source, classes.keys());
  for (const node of nodes) {
    if (!source.ast.is.IsIdentifier(node)) {
      continue;
    }
    const declaration = declarationForSymbols(source, symbols, node);
    const candidate = declaration === undefined ? undefined : classes.get(declaration);
    if (
      candidate === undefined ||
      node === source.ast.name(declaration) ||
      isTypeOnlyReference(source, node) ||
      isModuleForwardingReference(source, node)
    ) {
      continue;
    }
    const creation = source.ast.parent(node);
    const instance = creation === undefined || !source.ast.is.IsNewExpression(creation)
      ? undefined
      : source.ast.parent(creation);
    if (
      creation === undefined ||
      !source.ast.is.IsNewExpression(creation) ||
      source.ast.as.AsNewExpression(creation)?.Expression !== node ||
      instance !== candidate.instance
    ) {
      candidate.closed = false;
    }
  }
}

function auditInstanceReferences(
  source: TargetSourceProgram,
  nodes: readonly Node[],
  classes: ReadonlyMap<Node, SingletonClass>,
): void {
  const instances = new Map<Node, SingletonClass>();
  for (const candidate of classes.values()) {
    if (candidate.instance !== undefined) {
      instances.set(candidate.instance, candidate);
    }
  }
  const symbols = indexDeclarationSymbols(source, instances.keys());
  for (const node of nodes) {
    if (!source.ast.is.IsIdentifier(node)) {
      continue;
    }
    const declaration = declarationForSymbols(source, symbols, node);
    const candidate = declaration === undefined ? undefined : instances.get(declaration);
    if (
      candidate === undefined ||
      node === source.ast.name(declaration) ||
      isTypeOnlyReference(source, node) ||
      isModuleForwardingReference(source, node)
    ) {
      continue;
    }
    const access = containingPropertyAccess(source, node);
    const selected = access !== undefined && source.ast.is.IsPropertyAccessExpression(access)
      ? source.semantics.forNode(access).getResolvedPropertyAccessInfo(access)
      : access !== undefined && source.ast.is.IsElementAccessExpression(access)
      ? source.semantics.forNode(access).getResolvedElementAccessInfo(access)
      : undefined;
    if (
      access === undefined ||
      selected?.selectedDeclaration === undefined ||
      !candidate.members.has(selected.selectedDeclaration)
    ) {
      candidate.closed = false;
    }
  }
}

function containingPropertyAccess(
  source: TargetSourceProgram,
  reference: Node,
): Node | undefined {
  let current = reference;
  for (;;) {
    const parent = source.ast.parent(current);
    if (parent === undefined) {
      return undefined;
    }
    if (isTransparentParent(source, parent, current)) {
      current = parent;
      continue;
    }
    if (source.ast.is.IsPropertyAccessExpression(parent)) {
      return source.ast.as.AsPropertyAccessExpression(parent)?.Expression === current
        ? parent
        : undefined;
    }
    if (source.ast.is.IsElementAccessExpression(parent)) {
      return source.ast.as.AsElementAccessExpression(parent)?.Expression === current
        ? parent
        : undefined;
    }
    return undefined;
  }
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

function isTypeOnlyReference(source: TargetSourceProgram, node: Node): boolean {
  let current: Node | undefined = node;
  while (current !== undefined) {
    if (source.ast.is.IsTypeReferenceNode(current)) {
      return true;
    }
    if (
      source.ast.is.IsExpressionStatement(current) ||
      source.ast.is.IsVariableDeclaration(current) ||
      source.ast.is.IsCallExpression(current) ||
      source.ast.is.IsNewExpression(current) ||
      source.ast.is.IsClassDeclaration(current) ||
      source.ast.is.IsSourceFile(current)
    ) {
      return false;
    }
    current = source.ast.parent(current);
  }
  return false;
}

function hasDecorator(source: TargetSourceProgram, node: Node): boolean {
  return source.ast.modifiers(node).some((modifier) =>
    source.ast.is.IsDecorator(modifier)
  );
}
