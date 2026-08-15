import type { Node } from "@tsonic/tsts";
import type { TargetSourceProgram } from "@tsonic/target-api";
import {
  KindClassDeclaration,
  KindIdentifier,
} from "@tsonic/tsts/target-ast";

import type { TargetProgramIndex } from "../program-index.js";
import type { StorageOwnerTransportContract } from "../storage-owner-transport.js";
import { callableDeclarationAllowsSynchronousValue } from "./callable-contract.js";
import {
  declarationForSymbols,
  indexDeclarationSymbols,
  isTransparentParent,
} from "./callable-input-reference.js";
import { isModuleForwardingReference } from "./syntax.js";
import {
  auditStorageOwnerBoundaries,
  type StorageOwnerBinding,
} from "./storage-owner-boundaries.js";

export interface ConstructorCallableFields {
  readonly fields: ReadonlySet<Node>;
  readonly owners: ReadonlySet<Node>;
  ownerFor(field: Node): Node | undefined;
}

interface ConstructorClass {
  readonly declaration: Node;
  readonly constructor: Node;
  readonly fields: readonly Node[];
  closed: boolean;
}

export function collectConstructorCallableFields(
  source: TargetSourceProgram,
  program: TargetProgramIndex,
): ConstructorCallableFields {
  const classes = collectClasses(source, program);
  auditClassReferences(source, program, classes);
  const owners = new Set<Node>();
  const fields = new Set<Node>();
  const ownerByField = new Map<Node, Node>();
  for (const candidate of classes.values()) {
    if (!candidate.closed) {
      continue;
    }
    owners.add(candidate.declaration);
    for (const field of candidate.fields) {
      fields.add(field);
      ownerByField.set(field, candidate.declaration);
    }
  }
  return Object.freeze({
    fields,
    owners,
    ownerFor(field: Node): Node | undefined {
      return ownerByField.get(field);
    },
  });
}

export function closeConstructorCallableFields(
  source: TargetSourceProgram,
  program: TargetProgramIndex,
  selection: ConstructorCallableFields,
  values: ReadonlyMap<Node, readonly Node[]>,
  transports?: StorageOwnerTransportContract,
): ReadonlySet<Node> {
  const bindings = new Map<Node, StorageOwnerBinding>();
  for (const field of selection.fields) {
    const owner = selection.ownerFor(field);
    if (owner !== undefined) {
      bindings.set(field, {
        declaration: field,
        owner,
        inputs: values.get(field) ?? [],
        valid: true,
      });
    }
  }
  auditStorageOwnerBoundaries(
    source,
    program,
    selection.owners,
    bindings,
    (expression) => selectedConstructorField(source, expression, selection.fields),
    false,
    transports,
  );
  return new Set([...bindings.values()].filter((binding) => binding.valid)
    .map((binding) => binding.declaration));
}

function collectClasses(
  source: TargetSourceProgram,
  program: TargetProgramIndex,
): Map<Node, ConstructorClass> {
  const classes = new Map<Node, ConstructorClass>();
  for (const node of program.nodesOfKind(KindClassDeclaration)) {
    if (
      !source.navigation.isProjectDeclaration(node) ||
      source.ast.extendsHeritageElements(node).length !== 0 ||
      source.ast.hasModifierKind(node, "abstract") ||
      source.ast.hasModifierKind(node, "ambient") ||
      hasDecorator(source, node)
    ) {
      continue;
    }
    const constructors = source.ast.members(node).filter(
      (member): member is Node =>
        member !== undefined && source.ast.is.IsConstructorDeclaration(member),
    );
    const constructor = constructors.length === 1 ? constructors[0] : undefined;
    if (
      constructor === undefined ||
      source.ast.body(constructor) === undefined ||
      hasDecorator(source, constructor) ||
      source.ast.parameters(constructor).some((parameter) =>
        parameter === undefined ||
        hasDecorator(source, parameter) ||
        source.ast.as.AsParameterDeclaration(parameter)?.DotDotDotToken !== undefined
      )
    ) {
      continue;
    }
    const fields = source.ast.parameters(constructor).filter(
      (parameter): parameter is Node =>
        parameter !== undefined &&
        isParameterProperty(source, parameter) &&
        source.ast.is.IsIdentifier(source.ast.name(parameter)) &&
        callableDeclarationAllowsSynchronousValue(source, parameter),
    );
    if (fields.length !== 0) {
      classes.set(node, {
        declaration: node,
        constructor,
        fields: Object.freeze(fields),
        closed: true,
      });
    }
  }
  return classes;
}

function auditClassReferences(
  source: TargetSourceProgram,
  program: TargetProgramIndex,
  classes: ReadonlyMap<Node, ConstructorClass>,
): void {
  const symbols = indexDeclarationSymbols(source, classes.keys());
  for (const node of program.nodesOfKind(KindIdentifier)) {
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
    const construction = containingNew(source, node);
    if (
      construction !== undefined &&
      selectedConstructor(source, construction) === candidate.constructor
    ) {
      continue;
    }
    if (selectedStaticMember(source, node, candidate.declaration) !== undefined) {
      continue;
    }
    candidate.closed = false;
  }
}

function containingNew(
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
    return source.ast.is.IsNewExpression(parent) &&
        source.ast.as.AsNewExpression(parent)?.Expression === current
      ? parent
      : undefined;
  }
}

function selectedConstructor(
  source: TargetSourceProgram,
  creation: Node,
): Node | undefined {
  const semantics = source.semantics.forNode(creation);
  return semantics.getSignatureDeclaration(
    semantics.getResolvedSignature(creation),
  );
}

function selectedStaticMember(
  source: TargetSourceProgram,
  reference: Node,
  owner: Node,
): Node | undefined {
  const parent = source.ast.parent(reference);
  const selected = parent !== undefined &&
      source.ast.is.IsPropertyAccessExpression(parent) &&
      source.ast.as.AsPropertyAccessExpression(parent)?.Expression === reference
    ? source.semantics.forNode(parent).getResolvedPropertyAccessInfo(parent)
        ?.selectedDeclaration
    : parent !== undefined &&
        source.ast.is.IsElementAccessExpression(parent) &&
        source.ast.as.AsElementAccessExpression(parent)?.Expression === reference
    ? source.semantics.forNode(parent).getResolvedElementAccessInfo(parent)
        ?.selectedDeclaration
    : undefined;
  return selected !== undefined &&
      source.navigation.isProjectDeclaration(selected) &&
      source.ast.hasModifierKind(selected, "static") &&
      source.ast.parent(selected) === owner
    ? selected
    : undefined;
}

function selectedConstructorField(
  source: TargetSourceProgram,
  expression: Node,
  fields: ReadonlySet<Node>,
): Node | undefined {
  const selected = source.ast.is.IsPropertyAccessExpression(expression)
    ? source.semantics.forNode(expression).getResolvedPropertyAccessInfo(expression)
    : source.ast.is.IsElementAccessExpression(expression)
    ? source.semantics.forNode(expression).getResolvedElementAccessInfo(expression)
    : undefined;
  return selected?.selectedDeclaration !== undefined &&
      fields.has(selected.selectedDeclaration)
    ? selected.selectedDeclaration
    : undefined;
}

function isParameterProperty(
  source: TargetSourceProgram,
  node: Node,
): boolean {
  return (["public", "private", "protected", "readonly"] as const).some(
    (modifier) => source.ast.hasModifierKind(node, modifier),
  );
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
