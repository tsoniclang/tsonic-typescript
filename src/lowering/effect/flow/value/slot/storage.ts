import type { Node } from "@tsonic/tsts";
import type { TargetSourceProgram } from "@tsonic/target-api/source";

import type { TargetProgramIndex } from "../../../../program-index.js";
import { exactBindingWriteInput } from "../../storage/assignment.js";
import { storageDeclarationCanBeTracked } from "../../storage/owners.js";
import type { ExactInvocationInputIndex } from "../../invocation/inputs.js";
import type { ExactValueSlotSelector } from "./model.js";
import type { ClosedStorageOwnerAnalysis } from "../../storage/analysis.js";
import {
  auditStorageOwnerBoundaries,
  type StorageOwnerBoundaryDependencies,
  type StorageOwnerBinding,
} from "../../storage/owner-boundaries.js";
import type { TypeScriptPlanningObserver } from "../../../../planning-observer.js";
import type { ExactCallImplementations } from "../../callable/result-inputs.js";

export interface ExactStorageSlot {
  readonly declaration: Node;
  readonly inputs: readonly Node[];
}

export interface ExactStorageSlotInputIndex {
  slotFor(
    selector: Extract<ExactValueSlotSelector, { readonly kind: "property" }>,
  ): ExactStorageSlot | undefined;
  isInput(expression: Node): boolean;
  isOwnerReference(expression: Node): boolean;
}

export function createExactStorageSlotInputIndex(
  source: TargetSourceProgram,
  program: TargetProgramIndex,
  invocationInputs: ExactInvocationInputIndex | undefined,
  storageOwners: ClosedStorageOwnerAnalysis,
  planningObserver?: TypeScriptPlanningObserver,
  exactCallImplementations?: ExactCallImplementations,
  callableReferenceIsClosed?: (reference: Node) => boolean,
  boundaryDependencies?: StorageOwnerBoundaryDependencies,
): ExactStorageSlotInputIndex {
  const bindings = collectStorageSlotBindings(
    source,
    program,
    invocationInputs,
    storageOwners,
  );
  const owners = new Set([...bindings.values()].map((binding) => binding.owner));
  const topology = owners.size === 0
    ? undefined
    : storageOwners.topology(planningObserver);
  auditStorageOwnerBoundaries(
    source,
    program,
    owners,
    bindings,
    (expression) => {
      const declaration = selectedFieldDeclaration(source, expression);
      return declaration !== undefined && bindings.has(declaration)
        ? declaration
        : undefined;
    },
    false,
    undefined,
    exactCallImplementations,
    callableReferenceIsClosed,
    planningObserver,
    topology,
    boundaryDependencies,
  );
  const slots = new Map<Node, ExactStorageSlot>();
  const inputs = new Set<Node>();
  const closedOwners = new Set<Node>();
  for (const binding of bindings.values()) {
    if (!binding.valid) {
      continue;
    }
    slots.set(binding.declaration, Object.freeze({
      declaration: binding.declaration,
      inputs: binding.inputs,
    }));
    closedOwners.add(binding.owner);
    for (const input of binding.inputs) {
      inputs.add(input);
    }
  }
  return Object.freeze({
    slotFor(
      selector: Extract<ExactValueSlotSelector, { readonly kind: "property" }>,
    ): ExactStorageSlot | undefined {
      const declarations = [...selector.declarations].filter((declaration) =>
        slots.has(declaration)
      );
      if (declarations.length !== 1) {
        return undefined;
      }
      return slots.get(declarations[0]!);
    },
    isInput(expression: Node): boolean {
      return inputs.has(expression);
    },
    isOwnerReference(expression: Node): boolean {
      return topology?.ownersFor(expression).some((owner) =>
        closedOwners.has(owner)
      ) === true;
    },
  });
}

function collectStorageSlotBindings(
  source: TargetSourceProgram,
  program: TargetProgramIndex,
  invocationInputs: ExactInvocationInputIndex | undefined,
  storageOwners: ClosedStorageOwnerAnalysis,
): Map<Node, StorageOwnerBinding> {
  const result = new Map<Node, StorageOwnerBinding>();
  for (const owner of storageOwners.owners) {
    for (const member of source.ast.members(owner)) {
      if (member === undefined) {
        continue;
      }
      addStorageSlotBinding(
        source,
        program,
        invocationInputs,
        owner,
        member,
        result,
      );
      if (!source.ast.is.IsConstructorDeclaration(member)) {
        continue;
      }
      for (const parameter of source.ast.parameters(member)) {
        if (parameter !== undefined) {
          addStorageSlotBinding(
            source,
            program,
            invocationInputs,
            owner,
            parameter,
            result,
          );
        }
      }
    }
  }
  return result;
}

function addStorageSlotBinding(
  source: TargetSourceProgram,
  program: TargetProgramIndex,
  invocationInputs: ExactInvocationInputIndex | undefined,
  owner: Node,
  declaration: Node,
  bindings: Map<Node, StorageOwnerBinding>,
): void {
  if (!storageDeclarationCanBeTracked(source, declaration)) {
    return;
  }
  const inputs = exactStorageSlotInputs(
    source,
    program,
    invocationInputs,
    declaration,
  );
  if (inputs === undefined) {
    return;
  }
  bindings.set(declaration, {
    declaration,
    owner,
    inputs,
    valid: true,
  });
}

function exactStorageSlotInputs(
  source: TargetSourceProgram,
  program: TargetProgramIndex,
  invocationInputs: ExactInvocationInputIndex | undefined,
  declaration: Node,
): readonly Node[] | undefined {
  const inputs: Node[] = [];
  if (source.ast.is.IsPropertyDeclaration(declaration)) {
    const initializer = source.ast.as.AsPropertyDeclaration(declaration)
      ?.Initializer;
    if (initializer !== undefined) {
      inputs.push(initializer);
    }
  } else if (source.ast.is.IsParameterDeclaration(declaration)) {
    if (invocationInputs?.isClosed(declaration) !== true) {
      return undefined;
    }
    inputs.push(...invocationInputs.inputsFor(declaration) ?? []);
  } else {
    return undefined;
  }

  const writes = new Map(
    program.bindingWritesFor(declaration)
      .filter((write) => isFieldAccess(source, write.reference, declaration))
      .map((write) => [write.reference, write] as const),
  );
  for (const reference of source.navigation.referencesToDeclaration(declaration)) {
    if (
      reference === source.ast.name(declaration) ||
      parameterBindingReference(source, reference, declaration)
    ) {
      continue;
    }
    const access = fieldAccess(source, reference, declaration);
    if (access === undefined) {
      return undefined;
    }
    if (access.accessMode === "read") {
      continue;
    }
    const write = writes.get(reference);
    const input = write === undefined
      ? undefined
      : exactBindingWriteInput(source, write);
    if (access.accessMode !== "write" || input === undefined) {
      return undefined;
    }
    inputs.push(input);
  }
  return inputs.length === 0
    ? undefined
    : Object.freeze([...new Set(inputs)]);
}

export function exactClosedStorageSlotOwner(
  source: TargetSourceProgram,
  declaration: Node,
  closedOwners: ReadonlySet<Node>,
): Node | undefined {
  if (!storageDeclarationCanBeTracked(source, declaration)) {
    return undefined;
  }
  const parent = source.ast.parent(declaration);
  const owner = parent !== undefined &&
      source.ast.is.IsConstructorDeclaration(parent)
    ? source.ast.parent(parent)
    : parent;
  return owner !== undefined && closedOwners.has(owner) ? owner : undefined;
}

function fieldAccess(
  source: TargetSourceProgram,
  reference: Node,
  declaration: Node,
): { readonly accessMode: string } | undefined {
  const semantics = source.semantics.forNode(reference);
  const access = source.ast.is.IsPropertyAccessExpression(reference)
    ? semantics.operations.propertyAccess(reference)
    : source.ast.is.IsElementAccessExpression(reference)
    ? semantics.operations.elementAccess(reference)
    : undefined;
  return access?.selectedDeclaration === declaration ? access : undefined;
}

function selectedFieldDeclaration(
  source: TargetSourceProgram,
  expression: Node,
): Node | undefined {
  const semantics = source.semantics.forNode(expression);
  return source.ast.is.IsPropertyAccessExpression(expression)
    ? semantics.operations.propertyAccess(expression)?.selectedDeclaration
    : source.ast.is.IsElementAccessExpression(expression)
    ? semantics.operations.elementAccess(expression)?.selectedDeclaration
    : undefined;
}

function isFieldAccess(
  source: TargetSourceProgram,
  reference: Node,
  declaration: Node,
): boolean {
  return fieldAccess(source, reference, declaration) !== undefined;
}

function parameterBindingReference(
  source: TargetSourceProgram,
  reference: Node,
  declaration: Node,
): boolean {
  return source.ast.is.IsParameterDeclaration(declaration) &&
    source.ast.is.IsIdentifier(reference) &&
    source.navigation.sourceReferenceFor(reference)?.declaration === declaration;
}
