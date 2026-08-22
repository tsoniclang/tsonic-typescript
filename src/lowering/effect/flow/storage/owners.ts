import type { Node } from "@tsonic/tsts";
import type { TargetSourceProgram } from "@tsonic/target-api/source";
import { KindClassDeclaration } from "@tsonic/tsts/target-ast";

import type { TargetProgramIndex } from "../../../program-index.js";
import { isTransparentParent } from "../callable/input-reference.js";
import { isModuleForwardingReference } from "../../model/syntax.js";
import { resolveProjectInvocation } from "../../model/project-invocation.js";

export function collectClosedStorageOwners(
  source: TargetSourceProgram,
  program: TargetProgramIndex,
): ReadonlySet<Node> {
  const owners = new Set<Node>();
  for (const declaration of program.nodesOfKind(KindClassDeclaration)) {
    if (classCanOwnStorage(source, declaration)) {
      owners.add(declaration);
    }
  }
  for (const owner of [...owners]) {
    for (const reference of source.navigation.referencesToDeclaration(owner)) {
      auditClassReference(source, reference, owner, owners);
    }
  }
  return owners;
}

export function classCanOwnStorage(
  source: TargetSourceProgram,
  declaration: Node,
): boolean {
  return source.navigation.isProjectDeclaration(declaration) &&
    source.ast.is.IsClassDeclaration(declaration) &&
    source.ast.extendsHeritageElements(declaration).length === 0 &&
    !source.ast.hasModifierKind(declaration, "abstract") &&
    !source.ast.hasModifierKind(declaration, "ambient") &&
    !hasDecorator(source, declaration);
}

function auditClassReference(
  source: TargetSourceProgram,
  reference: Node,
  owner: Node,
  owners: Set<Node>,
): void {
  if (
    !owners.has(owner) ||
    reference === source.ast.name(owner) ||
    isTypeOnlyReference(source, reference) ||
    isModuleForwardingReference(source, reference) ||
    isExactConstruction(source, reference, owner) ||
    isExactStaticMember(source, reference, owner)
  ) {
    return;
  }
  owners.delete(owner);
}

function isExactConstruction(
  source: TargetSourceProgram,
  reference: Node,
  owner: Node,
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
    if (
      !source.ast.is.IsNewExpression(parent) ||
      source.ast.as.AsNewExpression(parent)?.Expression !== current ||
      source.ast.arguments(parent).some((argument) =>
        source.ast.is.IsSpreadElement(argument)
      )
    ) {
      return false;
    }
    const constructor = resolveProjectInvocation(source, parent)?.implementation;
    if (constructor === undefined) {
      return source.ast.members(owner).every((member) =>
        member === undefined ||
        !source.ast.is.IsConstructorDeclaration(member)
      );
    }
    return source.ast.is.IsConstructorDeclaration(constructor) &&
      source.ast.parent(constructor) === owner &&
      source.ast.body(constructor) !== undefined &&
      !hasDecorator(source, constructor) &&
      source.ast.parameters(constructor).every((parameter) =>
        parameter !== undefined &&
        !hasDecorator(source, parameter) &&
        source.ast.as.AsParameterDeclaration(parameter)?.DotDotDotToken ===
          undefined
      );
  }
}

function isExactStaticMember(
  source: TargetSourceProgram,
  reference: Node,
  owner: Node,
): boolean {
  const parent = source.ast.parent(reference);
  const selected = parent !== undefined &&
      source.ast.is.IsPropertyAccessExpression(parent) &&
      source.ast.as.AsPropertyAccessExpression(parent)?.Expression === reference
    ? source.semantics.forNode(parent).operations.propertyAccess(parent)
        ?.selectedDeclaration
    : parent !== undefined &&
        source.ast.is.IsElementAccessExpression(parent) &&
        source.ast.as.AsElementAccessExpression(parent)?.Expression === reference
    ? source.semantics.forNode(parent).operations.elementAccess(parent)
        ?.selectedDeclaration
    : undefined;
  return selected !== undefined &&
    source.navigation.isProjectDeclaration(selected) &&
    source.ast.hasModifierKind(selected, "static") &&
    source.ast.parent(selected) === owner;
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

export function storageDeclarationCanBeTracked(
  source: TargetSourceProgram,
  declaration: Node,
): boolean {
  const name = source.ast.name(declaration);
  if (
    source.ast.hasModifierKind(declaration, "static") ||
    hasDecorator(source, declaration) ||
    (name !== undefined && source.ast.is.IsComputedPropertyName(name))
  ) {
    return false;
  }
  if (source.ast.is.IsPropertyDeclaration(declaration)) {
    return true;
  }
  const parent = source.ast.parent(declaration);
  return source.ast.is.IsParameterDeclaration(declaration) &&
    parent !== undefined &&
    source.ast.is.IsConstructorDeclaration(parent) &&
    (["public", "private", "protected", "readonly"] as const).some(
      (modifier) => source.ast.hasModifierKind(declaration, modifier),
    );
}

function hasDecorator(source: TargetSourceProgram, node: Node): boolean {
  return source.ast.modifiers(node).some((modifier) =>
    source.ast.is.IsDecorator(modifier)
  );
}
