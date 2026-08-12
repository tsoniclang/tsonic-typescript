import type { Node } from "@tsonic/tsts";
import type { TargetSourceProgram } from "@tsonic/target-api";
import {
  KindClassDeclaration,
  KindElementAccessExpression,
  KindIdentifier,
  KindNewExpression,
  KindPropertyAccessExpression,
} from "@tsonic/tsts/target-ast";
import type { TargetProgramIndex } from "../program-index.js";

import {
  declarationForSymbols,
  indexDeclarationSymbols,
} from "./callable-input-reference.js";
import {
  createReturnParameterFlow,
  type ReturnParameterFlow,
} from "./return-parameters.js";
import { auditReturnStorageOwnerBoundaries } from "./return-storage-boundaries.js";

export interface ReturnStorageBinding {
  readonly declaration: Node;
  readonly inputs: readonly Node[];
}

export interface ReturnStorageFlow {
  bindingFor(expression: Node): ReturnStorageBinding | undefined;
}

interface ClosedReturnStorageFlow {
  readonly storage: ReadonlyMap<Node, ReturnStorageBinding>;
  readonly parameters: ReturnParameterFlow;
}

interface MutableStorageBinding {
  readonly declaration: Node;
  readonly owner: Node;
  readonly inputs: Node[];
  valid: boolean;
}

export function createReturnStorageFlow(
  source: TargetSourceProgram,
  program: TargetProgramIndex,
): ReturnStorageFlow {
  const owners = collectClosedOwners(source, program);
  const bindings = collectStorageBindings(source, owners);
  collectConstructorInputs(source, program, bindings);
  auditStorageReferences(source, program, bindings);
  auditReturnStorageOwnerBoundaries(
    source,
    program,
    owners,
    bindings,
    (expression) => selectedStorageDeclaration(source, expression),
  );
  const flow = closeReturnStorageFlow(source, program, bindings);
  return Object.freeze({
    bindingFor(expression: Node): ReturnStorageBinding | undefined {
      const declaration = selectedStorageDeclaration(source, expression);
      return declaration === undefined
        ? flow.parameters.bindingFor(expression)
        : flow.storage.get(declaration);
    },
  });
}

function closeReturnStorageFlow(
  source: TargetSourceProgram,
  program: TargetProgramIndex,
  bindings: ReadonlyMap<Node, MutableStorageBinding>,
): ClosedReturnStorageFlow {
  const storage = new Map<Node, ReturnStorageBinding>();
  for (const binding of bindings.values()) {
    if (binding.valid) {
      storage.set(binding.declaration, Object.freeze({
        declaration: binding.declaration,
        inputs: Object.freeze([...binding.inputs]),
      }));
    }
  }
  const storageDeclarations = new Set(storage.keys());
  return Object.freeze({
    storage,
    parameters: createReturnParameterFlow(
      source,
      program,
      [...storage.values()].flatMap((binding) => binding.inputs),
      storageDeclarations,
      (expression) => selectedStorageDeclaration(source, expression),
    ),
  });
}

function collectClosedOwners(
  source: TargetSourceProgram,
  program: TargetProgramIndex,
): ReadonlySet<Node> {
  const owners = new Set<Node>();
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
    const members = source.ast.members(node).filter(
      (member): member is Node => member !== undefined,
    );
    const constructors = members.filter((member) =>
      source.ast.is.IsConstructorDeclaration(member)
    );
    const nominal = members.some((member) =>
      !source.ast.hasModifierKind(member, "static") &&
      (source.ast.hasModifierKind(member, "private") ||
        source.ast.hasModifierKind(member, "protected"))
    );
    if (
      nominal &&
      constructors.length === 1 &&
      constructors.every((constructor) =>
        source.ast.body(constructor) !== undefined &&
        source.ast.hasModifierKind(constructor, "private")
      )
    ) {
      owners.add(node);
    }
  }
  return owners;
}

function collectStorageBindings(
  source: TargetSourceProgram,
  owners: ReadonlySet<Node>,
): Map<Node, MutableStorageBinding> {
  const bindings = new Map<Node, MutableStorageBinding>();
  for (const owner of owners) {
    for (const member of source.ast.members(owner)) {
      if (member === undefined || !storageFieldIsSupported(source, member)) {
        continue;
      }
      const initializer = storageInitializer(source, member);
      bindings.set(member, {
        declaration: member,
        owner,
        inputs: initializer === undefined ? [] : [initializer],
        valid: true,
      });
    }
    const constructor = source.ast.members(owner).find((member) =>
      member !== undefined && source.ast.is.IsConstructorDeclaration(member)
    );
    for (const parameter of source.ast.parameters(constructor)) {
      if (parameter === undefined || !storageFieldIsSupported(source, parameter)) {
        continue;
      }
      const initializer = storageInitializer(source, parameter);
      bindings.set(parameter, {
        declaration: parameter,
        owner,
        inputs: initializer === undefined ? [] : [initializer],
        valid: true,
      });
    }
  }
  return bindings;
}

function storageFieldIsSupported(
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
    return !source.ast.hasModifierKind(declaration, "ambient");
  }
  const parent = source.ast.parent(declaration);
  return source.ast.is.IsParameterDeclaration(declaration) &&
    parent !== undefined &&
    source.ast.is.IsConstructorDeclaration(parent) &&
    (["public", "private", "protected", "readonly"] as const).some((modifier) =>
      source.ast.hasModifierKind(declaration, modifier)
    );
}

function storageInitializer(
  source: TargetSourceProgram,
  declaration: Node,
): Node | undefined {
  if (source.ast.is.IsPropertyDeclaration(declaration)) {
    return source.ast.as.AsPropertyDeclaration(declaration)?.Initializer;
  }
  return source.ast.is.IsParameterDeclaration(declaration)
    ? source.ast.as.AsParameterDeclaration(declaration)?.Initializer
    : undefined;
}

function collectConstructorInputs(
  source: TargetSourceProgram,
  program: TargetProgramIndex,
  bindings: ReadonlyMap<Node, MutableStorageBinding>,
): void {
  for (const node of program.nodesOfKind(KindNewExpression)) {
    const semantics = source.semantics.forNode(node);
    const constructor = semantics.getSignatureDeclaration(
      semantics.getResolvedSignature(node),
    );
    if (constructor === undefined) {
      continue;
    }
    const parameters = source.ast.parameters(constructor);
    const arguments_ = source.ast.arguments(node);
    const invalid = arguments_.some((argument) =>
      source.ast.is.IsSpreadElement(argument)
    ) || parameters.some((parameter) =>
      source.ast.as.AsParameterDeclaration(parameter)?.DotDotDotToken !== undefined
    );
    for (let index = 0; index < parameters.length; index += 1) {
      const parameter = parameters[index];
      const binding = parameter === undefined ? undefined : bindings.get(parameter);
      if (binding === undefined) {
        continue;
      }
      if (invalid) {
        binding.valid = false;
        continue;
      }
      const argument = arguments_[index];
      if (argument !== undefined) {
        binding.inputs.push(argument);
      }
    }
  }
}

function auditStorageReferences(
  source: TargetSourceProgram,
  program: TargetProgramIndex,
  bindings: ReadonlyMap<Node, MutableStorageBinding>,
): void {
  const symbols = indexDeclarationSymbols(source, bindings.keys());
  for (const node of program.nodesOfKinds([
    KindIdentifier,
    KindPropertyAccessExpression,
    KindElementAccessExpression,
  ])) {
    const selected = selectedStorageDeclaration(source, node);
    const selectedBinding = selected === undefined ? undefined : bindings.get(selected);
    if (selectedBinding !== undefined) {
      const access = storageAccess(source, node);
      if (access === "read") {
        continue;
      }
      const input = access === "write" ? exactAssignedValue(source, node) : undefined;
      if (input === undefined) {
        selectedBinding.valid = false;
      } else {
        selectedBinding.inputs.push(input);
      }
      continue;
    }
    if (!source.ast.is.IsIdentifier(node)) {
      continue;
    }
    const declaration = declarationForSymbols(source, symbols, node);
    const binding = declaration === undefined ? undefined : bindings.get(declaration);
    if (
      binding !== undefined &&
      node !== source.ast.name(declaration) &&
      !identifierBelongsToSelectedAccess(source, node, binding.declaration)
    ) {
      binding.valid = false;
    }
  }
}

function selectedStorageDeclaration(
  source: TargetSourceProgram,
  expression: Node,
): Node | undefined {
  if (source.ast.is.IsPropertyAccessExpression(expression)) {
    return source.semantics.forNode(expression)
      .getResolvedPropertyAccessInfo(expression)?.selectedDeclaration;
  }
  return source.ast.is.IsElementAccessExpression(expression)
    ? source.semantics.forNode(expression)
      .getResolvedElementAccessInfo(expression)?.selectedDeclaration
    : undefined;
}

function storageAccess(
  source: TargetSourceProgram,
  expression: Node,
): "read" | "write" | "unsupported" {
  const selected = source.ast.is.IsPropertyAccessExpression(expression)
    ? source.semantics.forNode(expression).getResolvedPropertyAccessInfo(expression)
    : source.ast.is.IsElementAccessExpression(expression)
    ? source.semantics.forNode(expression).getResolvedElementAccessInfo(expression)
    : undefined;
  return selected?.accessMode === "read"
    ? "read"
    : selected?.accessMode === "write"
    ? "write"
    : "unsupported";
}

function exactAssignedValue(
  source: TargetSourceProgram,
  access: Node,
): Node | undefined {
  const parent = source.ast.parent(access);
  if (
    parent === undefined ||
    !source.ast.is.IsBinaryExpression(parent) ||
    source.ast.operatorKindName(parent) !== "KindEqualsToken" ||
    source.ast.as.AsBinaryExpression(parent)?.Left !== access
  ) {
    return undefined;
  }
  return source.ast.as.AsBinaryExpression(parent)?.Right;
}

function identifierBelongsToSelectedAccess(
  source: TargetSourceProgram,
  identifier: Node,
  declaration: Node,
): boolean {
  const parent = source.ast.parent(identifier);
  return parent !== undefined &&
    (source.ast.is.IsPropertyAccessExpression(parent) ||
      source.ast.is.IsElementAccessExpression(parent)) &&
    selectedStorageDeclaration(source, parent) === declaration;
}

function hasDecorator(source: TargetSourceProgram, node: Node): boolean {
  return source.ast.modifiers(node).some((modifier) =>
    source.ast.is.IsDecorator(modifier)
  );
}
