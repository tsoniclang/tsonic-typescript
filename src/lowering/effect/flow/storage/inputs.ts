import type { Node, Symbol } from "@tsonic/tsts";
import type { TargetSourceProgram } from "@tsonic/target-api";
import {
  KindElementAccessExpression,
  KindIdentifier,
  KindParameter,
  KindPropertyAccessExpression,
} from "@tsonic/tsts/target-ast";

import type { TargetProgramIndex } from "../../../program-index.js";
import type { CallableInputUseContract } from "../callable/input-use.js";
import {
  createExactInvocationInputIndex,
  type ExactInvocationInputIndex,
} from "../invocation/inputs.js";

import {
  callableDeclarationAllowsSynchronousValue,
} from "../../model/callable-contract.js";
import {
  callableDeclarationHasResolvableType,
} from "../../model/callable-contract/resolution.js";
import {
  declarationForSymbols,
  indexDeclarationSymbols,
  indexParameterUses,
  isCallablePresenceObservation,
  isTransparentParent,
  trackedInputDestination,
  transportedCallableDestinations,
} from "../callable/input-reference.js";
import type { ParameterUses } from "../callable/input-reference.js";
import {
  directContainingCall,
  isFunctionLike,
  isModuleForwardingReference,
  isProjectDeclarationOnlyName,
} from "../../model/syntax.js";
import { resolveProjectInvocation } from "../../model/project-invocation.js";
import {
  auditCallableLocalUse,
  collectCallableLocals,
} from "../callable/local-inputs.js";
import {
  collectCallableFields,
} from "./fields.js";
import { closeDependencyCandidates } from "../../closure/dependency-closure.js";
import { typeMaySuspend } from "../../model/synchronous.js";
import { createCallableStorageContracts } from "./contracts.js";
import type { CallableStorageContract } from "./contracts.js";

export interface CallableStorageInputs {
  readonly values: ReadonlyMap<Node, readonly Node[]>;
  readonly closed: ReadonlySet<Node>;
  readonly contracts: readonly CallableStorageContract[];
}

interface ClosedParameters {
  readonly declarations: ReadonlySet<Node>;
  readonly uses: ParameterUses;
}

interface ReferenceCounts {
  total: number;
  admitted: number;
}

export function collectCallableStorageInputs(
  source: TargetSourceProgram,
  program: TargetProgramIndex,
  excludedDeclarations: ReadonlySet<Node>,
  inputUses?: CallableInputUseContract,
  exactInvocationInputs?: ExactInvocationInputIndex,
): CallableStorageInputs {
  const invocationInputs = exactInvocationInputs ??
    createExactInvocationInputIndex(source, program);
  const callableFields = collectCallableFields(source, program);
  const fields = callableFields.declarations;
  const parameters = collectCallableParameters(source, program);
  const localValues = collectCallableLocals(
    source,
    excludedDeclarations,
    program,
  );
  const locals = new Set(localValues.keys());
  const storageDeclarations = new Set([
    ...parameters.keys(),
    ...fields,
    ...locals,
  ]);
  const storageSymbols = indexDeclarationSymbols(source, storageDeclarations);
  const parameterValues = new Map<Node, Node[]>();
  const fieldValues = new Map<Node, Node[]>(
    [...callableFields.initialValues].map(([field, values]) => [
      field,
      [...values],
    ]),
  );
  const invalidInputs = new Set<Node>();

  for (const declaration of new Set([...parameters.keys(), ...fields])) {
    if (invocationInputs.isInvalid(declaration)) {
      invalidInputs.add(declaration);
    }
    for (const input of invocationInputs.inputsFor(declaration) ?? []) {
      if (parameters.has(declaration)) {
        append(parameterValues, declaration, input);
      }
      if (fields.has(declaration)) {
        append(fieldValues, declaration, input);
      }
    }
  }

  const parameterClosure = closeParameters(
    source,
    parameters,
    fields,
    locals,
    invalidInputs,
    invocationInputs,
    program,
    inputUses,
  );
  for (const [parameter, assigned] of parameterClosure.uses.assignedValues) {
    for (const value of assigned) {
      append(parameterValues, parameter, value);
    }
  }
  const preliminaryParameters = parameterClosure.declarations;

  const fieldCounts = new Map<Node, ReferenceCounts>();
  const localCounts = new Map<Node, ReferenceCounts>();
  const storageDestinations = new Map<Node, Set<Node>>();
  for (const field of fields) {
    fieldCounts.set(field, { total: 0, admitted: 0 });
  }
  for (const local of locals) {
    localCounts.set(local, { total: 0, admitted: 0 });
  }
  for (const node of program.nodesOfKinds([
    KindIdentifier,
    KindPropertyAccessExpression,
    KindElementAccessExpression,
  ])) {
    auditFieldUse(
      source,
      node,
      fieldCounts,
      fieldValues,
      fields,
      storageDeclarations,
      storageSymbols,
      storageDestinations,
      inputUses,
    );
    auditCallableLocalUse(
      source,
      node,
      localCounts,
      localValues,
      storageDeclarations,
      storageSymbols,
      storageDestinations,
      inputUses,
      invocationInputs,
    );
  }
  const validFields = callableFields.close(
    fieldValues,
    inputUses?.invocationTransports,
  );

  const candidateFields = new Set<Node>();
  for (const [field, counts] of fieldCounts) {
    const constructor = source.ast.parent(field);
    if (
      constructor !== undefined &&
      !invalidInputs.has(field) &&
      counts.total === counts.admitted &&
      counts.admitted !== 0 &&
      fieldValues.has(field) &&
      validFields.has(field)
    ) {
      candidateFields.add(field);
    }
  }
  const candidateLocals = new Set<Node>();
  for (const [local, counts] of localCounts) {
    if (
      counts.total === counts.admitted &&
      counts.admitted !== 0 &&
      (localValues.get(local)?.length ?? 0) !== 0
    ) {
      candidateLocals.add(local);
    }
  }
  const closedDeclarations = closeStorageDeclarations(
    new Set([
      ...preliminaryParameters,
      ...candidateFields,
      ...candidateLocals,
    ]),
    parameterClosure.uses.dependencies,
    storageDestinations,
  );
  const closedParameters = new Set([...preliminaryParameters].filter(
    (parameter) => closedDeclarations.has(parameter),
  ));
  const closedFields = new Set([...candidateFields].filter(
    (field) => closedDeclarations.has(field),
  ));
  const closedLocals = new Set([...candidateLocals].filter(
    (local) => closedDeclarations.has(local),
  ));

  const values = new Map<Node, readonly Node[]>();
  for (const parameter of closedParameters) {
    const inputs = parameterValues.get(parameter);
    if (inputs !== undefined && inputs.length !== 0) {
      values.set(parameter, Object.freeze(inputs));
    }
  }
  for (const field of closedFields) {
    const inputs = fieldValues.get(field);
    if (inputs !== undefined && inputs.length !== 0) {
      values.set(field, Object.freeze(inputs));
    }
  }
  for (const local of closedLocals) {
    const inputs = localValues.get(local);
    if (inputs !== undefined && inputs.length !== 0) {
      values.set(local, Object.freeze(inputs));
    }
  }
  const contracts = createCallableStorageContracts(
    source,
    closedDeclarations,
    [parameterClosure.uses.dependencies, storageDestinations],
  );
  return Object.freeze({
    values,
    closed: closedDeclarations,
    contracts: Object.freeze(contracts),
  });
}

function closeStorageDeclarations(
  candidates: Set<Node>,
  parameterDestinations: ReadonlyMap<Node, ReadonlySet<Node>>,
  storageDestinations: ReadonlyMap<Node, ReadonlySet<Node>>,
): Set<Node> {
  return new Set(closeDependencyCandidates(
    candidates,
    [parameterDestinations, storageDestinations],
  ));
}

function collectCallableParameters(
  source: TargetSourceProgram,
  program: TargetProgramIndex,
): ReadonlyMap<Node, Node> {
  const parameters = new Map<Node, Node>();
  for (const node of program.nodesOfKind(KindParameter)) {
    if (
      isParameterProperty(source, node) ||
      !callableDeclarationHasResolvableType(source, node)
    ) {
      continue;
    }
    const owner = source.ast.parent(node);
    if (
      owner !== undefined &&
      isFunctionLike(source, owner) &&
      source.ast.body(owner) !== undefined
    ) {
      parameters.set(node, owner);
    }
  }
  return parameters;
}

function closeParameters(
  source: TargetSourceProgram,
  parameters: ReadonlyMap<Node, Node>,
  fields: ReadonlySet<Node>,
  locals: ReadonlySet<Node>,
  invalidParameters: ReadonlySet<Node>,
  invocationInputs: ExactInvocationInputIndex,
  program: TargetProgramIndex,
  inputUses?: CallableInputUseContract,
): ClosedParameters {
  const ownerCounts = new Map<Node, ReferenceCounts>();
  for (const owner of parameters.values()) {
    ownerCounts.set(owner, { total: 0, admitted: 0 });
  }
  const ownerSymbols = indexDeclarationSymbols(source, ownerCounts.keys());
  for (const node of program.nodesOfKinds([
    KindIdentifier,
    KindPropertyAccessExpression,
    KindElementAccessExpression,
  ])) {
    auditCallableOwnerReference(
      source,
      node,
      ownerCounts,
      ownerSymbols,
      inputUses,
    );
  }
  const closed = new Set<Node>();
  for (const [parameter, owner] of parameters) {
    const counts = ownerCounts.get(owner);
    if (
      !invalidParameters.has(parameter) &&
      counts !== undefined &&
      counts.total === counts.admitted &&
      (counts.admitted !== 0 || invocationInputs.isClosed(parameter))
    ) {
      closed.add(parameter);
    }
  }
  const uses = indexParameterUses(
    source,
    parameters.keys(),
    new Set([...fields, ...locals]),
    program,
    inputUses,
  );
  for (const parameter of uses.invalid) {
    closed.delete(parameter);
  }
  return {
    declarations: closeDependencyCandidates(
      closed,
      [uses.dependencies],
      (dependency) => parameters.has(dependency),
    ),
    uses,
  };
}

function auditCallableOwnerReference(
  source: TargetSourceProgram,
  node: Node,
  tracked: ReadonlyMap<Node, ReferenceCounts>,
  trackedSymbols: ReadonlyMap<Symbol, Node>,
  inputUses?: CallableInputUseContract,
): void {
  let declaration: Node | undefined;
  let reference: Node | undefined;
  if (source.ast.is.IsPropertyAccessExpression(node)) {
    declaration = source.semantics.forNode(node)
      .getResolvedPropertyAccessInfo(node)?.selectedDeclaration;
    reference = node;
  } else if (source.ast.is.IsElementAccessExpression(node)) {
    declaration = source.semantics.forNode(node)
      .getResolvedElementAccessInfo(node)?.selectedDeclaration;
    reference = node;
  } else if (
    source.ast.is.IsIdentifier(node) &&
    !isPropertyAccessName(source, node)
  ) {
    declaration = declarationForSymbols(source, trackedSymbols, node);
    reference = node;
  }
  const counts = declaration === undefined ? undefined : tracked.get(declaration);
  if (
    counts === undefined ||
    reference === undefined ||
    reference === source.ast.name(declaration) ||
    isProjectDeclarationOnlyName(source, reference) ||
    isModuleForwardingReference(source, reference) ||
    isTypeOnlyReference(source, reference)
  ) {
    return;
  }
  counts.total += 1;
  const call = directContainingCall(source, reference);
  const selected = call === undefined
    ? undefined
    : resolveProjectInvocation(source, call)?.implementation;
  if (
    selected === declaration ||
    inputUses?.useFor(reference) !== undefined
  ) {
    counts.admitted += 1;
  }
}

function auditFieldUse(
  source: TargetSourceProgram,
  node: Node,
  tracked: ReadonlyMap<Node, ReferenceCounts>,
  values: Map<Node, Node[]>,
  fields: ReadonlySet<Node>,
  storageDeclarations: ReadonlySet<Node>,
  storageSymbols: ReadonlyMap<Symbol, Node>,
  destinations: Map<Node, Set<Node>>,
  inputUses?: CallableInputUseContract,
): void {
  const selected = source.ast.is.IsPropertyAccessExpression(node)
    ? source.semantics.forNode(node).getResolvedPropertyAccessInfo(node)
    : source.ast.is.IsElementAccessExpression(node)
    ? source.semantics.forNode(node).getResolvedElementAccessInfo(node)
    : undefined;
  const field = selected?.selectedDeclaration;
  const counts = field === undefined ? undefined : tracked.get(field);
  if (field === undefined || counts === undefined) {
    return;
  }
  counts.total += 1;
  if (selected?.accessMode === "write") {
    const assigned = exactAssignedValue(source, node);
    if (assigned !== undefined) {
      append(values, field, assigned);
      counts.admitted += 1;
    }
    return;
  }
  if (selected?.accessMode !== "read" || selected.optionalChain) {
    return;
  }
  const destination = trackedInputDestination(
    source,
    node,
    storageDeclarations,
    storageSymbols,
  );
  const transported = transportedCallableDestinations(
    source,
    node,
    storageDeclarations,
    storageSymbols,
    inputUses,
  );
  if (
    directContainingCall(source, node) !== undefined ||
    isCallablePresenceObservation(source, node) ||
    destination !== undefined ||
    transported !== undefined
  ) {
    counts.admitted += 1;
    if (destination !== undefined) {
      appendSet(destinations, field, destination);
    }
    for (const transportedDestination of transported ?? []) {
      appendSet(destinations, field, transportedDestination);
    }
  }
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

function isParameterProperty(
  source: TargetSourceProgram,
  node: Node,
): boolean {
  const parent = source.ast.parent(node);
  return parent !== undefined &&
    source.ast.is.IsConstructorDeclaration(parent) &&
    (["public", "private", "protected", "readonly"] as const).some((modifier) =>
      source.ast.hasModifierKind(node, modifier)
    );
}

function isPropertyAccessName(
  source: TargetSourceProgram,
  node: Node,
): boolean {
  const parent = source.ast.parent(node);
  return parent !== undefined &&
    source.ast.is.IsPropertyAccessExpression(parent) &&
    source.ast.as.AsPropertyAccessExpression(parent)?.name === node;
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

function append(target: Map<Node, Node[]>, key: Node, value: Node): void {
  const values = target.get(key);
  if (values === undefined) {
    target.set(key, [value]);
  } else {
    values.push(value);
  }
}

function appendSet(target: Map<Node, Set<Node>>, key: Node, value: Node): void {
  const values = target.get(key);
  if (values === undefined) {
    target.set(key, new Set([value]));
  } else {
    values.add(value);
  }
}
