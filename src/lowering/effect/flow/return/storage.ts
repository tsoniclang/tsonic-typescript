import type { Node } from "@tsonic/tsts";
import type { TargetSourceProgram } from "@tsonic/target-api/source";
import {
  KindElementAccessExpression,
  KindIdentifier,
  KindPropertyAccessExpression,
} from "@tsonic/tsts/target-ast";
import type { TargetProgramIndex } from "../../../program-index.js";
import type { InvocationTransportContract } from "../../../invocation-transport.js";
import type { ExactInvocationInputIndex } from "../invocation/inputs.js";
import type { ExactCallImplementations } from "../callable/result-inputs.js";

import {
  declarationForSymbols,
  indexDeclarationSymbols,
} from "../callable/input-reference.js";
import { auditStorageOwnerBoundaries } from "../storage/owner-boundaries.js";
import {
  collectClosedStorageOwners,
  storageDeclarationCanBeTracked,
} from "../storage/owners.js";

export interface ReturnStorageBinding {
  readonly declaration: Node;
  readonly inputs: readonly Node[];
}

export interface ReturnStorageFlow {
  bindingFor(expression: Node): ReturnStorageBinding | undefined;
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
  invocationInputs: ExactInvocationInputIndex,
  transports?: InvocationTransportContract,
  exactCallImplementations?: ExactCallImplementations,
  callableReferenceIsClosed?: (reference: Node) => boolean,
): ReturnStorageFlow {
  const owners = collectClosedStorageOwners(source, program);
  const bindings = collectStorageBindings(source, owners);
  collectConstructorInputs(invocationInputs, bindings);
  auditStorageReferences(source, program, bindings);
  auditStorageOwnerBoundaries(
    source,
    program,
    owners,
    bindings,
    (expression) => selectedStorageDeclaration(source, expression),
    true,
    transports,
    invocationInputs,
    exactCallImplementations,
    callableReferenceIsClosed,
  );
  const storage = closeReturnStorageFlow(bindings);
  return Object.freeze({
    bindingFor(expression: Node): ReturnStorageBinding | undefined {
      const declaration = selectedStorageDeclaration(source, expression);
      return declaration === undefined ? undefined : storage.get(declaration);
    },
  });
}

function closeReturnStorageFlow(
  bindings: ReadonlyMap<Node, MutableStorageBinding>,
): ReadonlyMap<Node, ReturnStorageBinding> {
  const storage = new Map<Node, ReturnStorageBinding>();
  for (const binding of bindings.values()) {
    if (binding.valid) {
      storage.set(binding.declaration, Object.freeze({
        declaration: binding.declaration,
        inputs: Object.freeze([...binding.inputs]),
      }));
    }
  }
  return storage;
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
    for (const constructor of source.ast.members(owner)) {
      if (
        constructor === undefined ||
        !source.ast.is.IsConstructorDeclaration(constructor)
      ) {
        continue;
      }
      for (const parameter of source.ast.parameters(constructor)) {
        if (
          parameter === undefined ||
          !storageFieldIsSupported(source, parameter)
        ) {
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
  }
  return bindings;
}

function storageFieldIsSupported(
  source: TargetSourceProgram,
  declaration: Node,
): boolean {
  return storageDeclarationCanBeTracked(source, declaration);
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
  invocationInputs: ExactInvocationInputIndex,
  bindings: ReadonlyMap<Node, MutableStorageBinding>,
): void {
  for (const binding of bindings.values()) {
    if (!invocationInputs.isClosed(binding.declaration)) {
      if (invocationInputs.isInvalid(binding.declaration)) {
        binding.valid = false;
      }
      continue;
    }
    binding.inputs.push(...invocationInputs.inputsFor(binding.declaration) ?? []);
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
      .operations.propertyAccess(expression)?.selectedDeclaration;
  }
  return source.ast.is.IsElementAccessExpression(expression)
    ? source.semantics.forNode(expression)
      .operations.elementAccess(expression)?.selectedDeclaration
    : undefined;
}

function storageAccess(
  source: TargetSourceProgram,
  expression: Node,
): "read" | "write" | "unsupported" {
  const selected = source.ast.is.IsPropertyAccessExpression(expression)
    ? source.semantics.forNode(expression).operations.propertyAccess(expression)
    : source.ast.is.IsElementAccessExpression(expression)
    ? source.semantics.forNode(expression).operations.elementAccess(expression)
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
