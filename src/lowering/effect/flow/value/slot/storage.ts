import type { Node } from "@tsonic/tsts";
import type { TargetSourceProgram } from "@tsonic/target-api/source";

import type { TargetProgramIndex } from "../../../../program-index.js";
import { KindThisKeyword } from "@tsonic/tsts/target-ast";
import {
  exactBindingWriteInput,
  exactConstructorFieldWriteInput,
} from "../../storage/assignment.js";
import {
  classCanOwnStorage,
  storageDeclarationCanBeTracked,
} from "../../storage/owners.js";
import type { ExactInvocationInputIndex } from "../../invocation/inputs.js";
import type { ExactValueSlotSelector } from "./model.js";
import type { ClosedStorageOwnerAnalysis } from "../../storage/analysis.js";
import type { ExactAggregateProjectionIndex } from "../../aggregate/projection.js";
import { resolveExactSourceInvocation } from "../../../model/exact-source-invocation.js";
import { exactSourceCallInputsForDeclaration } from "../../invocation/call-binding.js";
import { transparentExpression } from "../../../model/syntax.js";
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
  constructionInputsFor(
    expression: Node,
    selector: Extract<ExactValueSlotSelector, { readonly kind: "property" }>,
  ): readonly Node[] | undefined;
  isInput(expression: Node): boolean;
  isOwnerReference(expression: Node): boolean;
}

export function createExactStorageSlotInputIndex(
  source: TargetSourceProgram,
  program: TargetProgramIndex,
  projections: ExactAggregateProjectionIndex,
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
    storageOwners.bodyInspectionIsExact,
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
    constructionInputsFor(
      expression: Node,
      selector: Extract<ExactValueSlotSelector, { readonly kind: "property" }>,
    ): readonly Node[] | undefined {
      return exactConstructionSlotInputs(
        source,
        program,
        projections,
        expression,
        selector,
        exactCallImplementations,
        storageOwners.owners,
        storageOwners.bodyInspectionIsExact,
      );
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

function exactConstructionSlotInputs(
  source: TargetSourceProgram,
  program: TargetProgramIndex,
  projections: ExactAggregateProjectionIndex,
  expression: Node,
  selector: Extract<ExactValueSlotSelector, { readonly kind: "property" }>,
  exactCallImplementations: ExactCallImplementations | undefined,
  closedOwners: ReadonlySet<Node>,
  bodyInspectionIsCertified: (declaration: Node) => boolean,
): readonly Node[] | undefined {
  if (!source.ast.is.IsNewExpression(expression)) {
    return undefined;
  }
  const direct = resolveExactSourceInvocation(
    source,
    expression,
    bodyInspectionIsCertified,
  )?.implementation;
  const constructors = new Set([
    ...(direct === undefined ? [] : [direct]),
    ...(exactCallImplementations?.(expression) ?? []),
  ]);
  const constructor = constructors.size === 1
    ? [...constructors][0]
    : undefined;
  const owner = constructor === undefined ? undefined : source.ast.parent(constructor);
  const body = constructor === undefined ? undefined : source.ast.body(constructor);
  if (
    constructor === undefined ||
    owner === undefined ||
    body === undefined ||
    !source.ast.is.IsConstructorDeclaration(constructor) ||
    !classCanOwnStorage(source, owner, bodyInspectionIsCertified) ||
    !closedOwners.has(owner) ||
    hasDecorator(source, constructor) ||
    !constructorParametersAreTransparent(source, constructor) ||
    source.ast.members(owner).some((member) =>
      member !== undefined &&
      source.ast.is.IsPropertyDeclaration(member) &&
      source.ast.as.AsPropertyDeclaration(member)?.Initializer !== undefined
    )
  ) {
    return undefined;
  }
  const declaration = selectedConstructionSlot(
    source,
    owner,
    constructor,
    selector,
  );
  if (declaration === undefined) {
    return undefined;
  }
  const parameter = source.ast.is.IsParameterDeclaration(declaration)
    ? declaration
    : assignedConstructorParameter(
      source,
      program,
      owner,
      constructor,
      declaration,
    );
  if (parameter === undefined) {
    return undefined;
  }
  const assignments = source.ast.statements(body);
  if (
    source.ast.is.IsParameterDeclaration(declaration)
      ? assignments.length !== 0
      : !constructorAssignmentsAreTransparent(
        source,
        owner,
        constructor,
        assignments,
      )
  ) {
    return undefined;
  }
  return exactSourceCallInputsForDeclaration(
    source,
    expression,
    constructor,
    projections,
  )?.inputs.get(parameter);
}

function selectedConstructionSlot(
  source: TargetSourceProgram,
  owner: Node,
  constructor: Node,
  selector: Extract<ExactValueSlotSelector, { readonly kind: "property" }>,
): Node | undefined {
  const candidates = [
    ...source.ast.members(owner).filter((member): member is Node =>
      member !== undefined && source.ast.is.IsPropertyDeclaration(member)
    ),
    ...source.ast.parameters(constructor).filter((parameter): parameter is Node =>
      parameter !== undefined && storageDeclarationCanBeTracked(source, parameter)
    ),
  ].filter((declaration) =>
    source.ast.hasModifierKind(declaration, "readonly") &&
    selectorSelectsDeclaration(source, selector, declaration)
  );
  return candidates.length === 1 ? candidates[0] : undefined;
}

function assignedConstructorParameter(
  source: TargetSourceProgram,
  program: TargetProgramIndex,
  owner: Node,
  constructor: Node,
  declaration: Node,
): Node | undefined {
  const writes = program.bindingWritesFor(declaration);
  if (writes.length !== 1) {
    return undefined;
  }
  const write = writes[0]!;
  const input = exactBindingWriteInput(source, write);
  const access = source.ast.as.AsPropertyAccessExpression(write.reference);
  const parameter = transparentExpression(source, input);
  return access?.Expression !== undefined &&
      source.ast.kind(access.Expression) === KindThisKeyword &&
      parameter !== undefined &&
      source.ast.is.IsIdentifier(parameter) &&
      source.navigation.sourceReferenceFor(parameter)?.declaration !== undefined &&
      source.ast.parameters(constructor).includes(
        source.navigation.sourceReferenceFor(parameter)?.declaration,
      ) &&
      source.ast.parent(constructor) === owner
    ? source.navigation.sourceReferenceFor(parameter)?.declaration
    : undefined;
}

function constructorAssignmentsAreTransparent(
  source: TargetSourceProgram,
  owner: Node,
  constructor: Node,
  statements: readonly (Node | undefined)[],
): boolean {
  const assigned = new Set<Node>();
  for (const statement of statements) {
    const expression = statement === undefined ||
        !source.ast.is.IsExpressionStatement(statement)
      ? undefined
      : source.ast.as.AsExpressionStatement(statement)?.Expression;
    const binary = expression === undefined ||
        !source.ast.is.IsBinaryExpression(expression) ||
        source.ast.operatorKindName(expression) !== "KindEqualsToken"
      ? undefined
      : source.ast.as.AsBinaryExpression(expression);
    const access = binary?.Left === undefined ||
        !source.ast.is.IsPropertyAccessExpression(binary.Left)
      ? undefined
      : source.ast.as.AsPropertyAccessExpression(binary.Left);
    const declaration = binary?.Left === undefined
      ? undefined
      : source.semantics.forNode(binary.Left).operations.propertyAccess(binary.Left)
        ?.selectedDeclaration;
    const parameter = transparentExpression(source, binary?.Right);
    if (
      access?.Expression === undefined ||
      source.ast.kind(access.Expression) !== KindThisKeyword ||
      declaration === undefined ||
      source.ast.parent(declaration) !== owner ||
      !source.ast.is.IsPropertyDeclaration(declaration) ||
      !source.ast.hasModifierKind(declaration, "readonly") ||
      assigned.has(declaration) ||
      parameter === undefined ||
      !source.ast.is.IsIdentifier(parameter) ||
      !source.ast.parameters(constructor).includes(
        source.navigation.sourceReferenceFor(parameter)?.declaration,
      )
    ) {
      return false;
    }
    assigned.add(declaration);
  }
  return true;
}

function constructorParametersAreTransparent(
  source: TargetSourceProgram,
  constructor: Node,
): boolean {
  return source.ast.parameters(constructor).every((parameter) => {
    const parsed = source.ast.as.AsParameterDeclaration(parameter);
    return parameter !== undefined &&
      parsed !== undefined &&
      parsed.DotDotDotToken === undefined &&
      parsed.QuestionToken === undefined &&
      parsed.Initializer === undefined &&
      !hasDecorator(source, parameter);
  });
}

function selectorSelectsDeclaration(
  source: TargetSourceProgram,
  selector: Extract<ExactValueSlotSelector, { readonly kind: "property" }>,
  declaration: Node,
): boolean {
  if (selector.declarations.has(declaration)) {
    return true;
  }
  const symbol = source.navigation.sourceReferenceFor(source.ast.name(declaration))
    ?.symbol;
  return symbol !== undefined && selector.symbols.has(symbol);
}

function hasDecorator(source: TargetSourceProgram, node: Node): boolean {
  return source.ast.modifiers(node).some((modifier) =>
    source.ast.is.IsDecorator(modifier)
  );
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
  if (
    source.ast.is.IsPropertyDeclaration(declaration) &&
    !source.ast.hasModifierKind(declaration, "readonly") &&
    [...writes.values()].some((write) =>
      exactConstructorFieldWriteInput(source, write, declaration) !== undefined
    )
  ) {
    return undefined;
  }
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
