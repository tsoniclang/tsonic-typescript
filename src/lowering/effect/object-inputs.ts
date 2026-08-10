import type { Node, Symbol } from "@tsonic/tsts";
import type { TargetSourceProgram } from "@tsonic/target-api";

import {
  callableDeclarationAllowsSynchronousValue,
  callableDeclarationSynchronousReturnTypes,
} from "./callable-contract.js";
import {
  declarationForSymbols,
  indexDeclarationSymbols,
  indexParameterUses,
  isCallablePresenceObservation,
  isTransparentParent,
  trackedInputDestination,
} from "./callable-input-reference.js";
import {
  directContainingCall,
  forEachProgramNode,
  isModuleForwardingReference,
} from "./syntax.js";
import { typeMaySuspend } from "./synchronous.js";

export interface CallableObjectInputs {
  readonly values: ReadonlyMap<Node, readonly Node[]>;
  readonly closed: ReadonlySet<Node>;
  readonly contracts: readonly CallableObjectContract[];
}

export interface CallableObjectContract {
  readonly declaration: Node;
  readonly returnTypes: readonly Node[];
}

interface ReferenceCounts {
  total: number;
  admitted: number;
}

interface Invocation {
  readonly declaration: Node;
  readonly arguments: readonly Node[];
}

export function collectCallableObjectInputs(
  source: TargetSourceProgram,
  closedAliases: ReadonlySet<Node>,
): CallableObjectInputs {
  const fields = collectPrivateConstructorFields(source);
  const parameters = collectCallableParameters(source);
  const parameterValues = new Map<Node, Node[]>();
  const fieldValues = new Map<Node, Node[]>();
  const invalidOwners = new Set<Node>();

  forEachProgramNode(source, (node) => {
    const invocation = invocationAt(source, node);
    if (invocation === undefined) {
      return;
    }
    collectInvocationInputs(
      source,
      invocation,
      parameters,
      fields,
      parameterValues,
      fieldValues,
      invalidOwners,
    );
  });

  const closedParameters = closeParameters(
    source,
    parameters,
    fields,
    invalidOwners,
  );

  const fieldCounts = new Map<Node, ReferenceCounts>();
  for (const field of fields) {
    fieldCounts.set(field, { total: 0, admitted: 0 });
  }
  forEachProgramNode(source, (node) => {
    auditFieldUse(
      source,
      node,
      fieldCounts,
      fieldValues,
      fields,
      closedParameters,
      closedAliases,
    );
  });

  const closedFields = new Set<Node>();
  for (const [field, counts] of fieldCounts) {
    const constructor = source.ast.parent(field);
    if (
      constructor !== undefined &&
      !invalidOwners.has(constructor) &&
      counts.total === counts.admitted &&
      counts.admitted !== 0 &&
      fieldValues.has(field)
    ) {
      closedFields.add(field);
    }
  }

  const values = new Map<Node, readonly Node[]>();
  for (const parameter of closedParameters) {
    const inputs = parameterValues.get(parameter);
    if (inputs !== undefined && inputs.length !== 0) {
      values.set(parameter, Object.freeze([...inputs]));
    }
  }
  for (const field of closedFields) {
    const inputs = fieldValues.get(field);
    if (inputs !== undefined && inputs.length !== 0) {
      values.set(field, Object.freeze([...inputs]));
    }
  }
  const contracts = [...closedFields].flatMap((field) => {
    const returnTypes = callableDeclarationSynchronousReturnTypes(source, field);
    return returnTypes === undefined
      ? []
      : [Object.freeze({ declaration: field, returnTypes })];
  });
  return Object.freeze({
    values,
    closed: new Set([...closedParameters, ...closedFields]),
    contracts: Object.freeze(contracts),
  });
}
function collectPrivateConstructorFields(
  source: TargetSourceProgram,
): ReadonlySet<Node> {
  const fields = new Set<Node>();
  forEachProgramNode(source, (node) => {
    if (
      !source.ast.is.IsParameterDeclaration(node) ||
      !isParameterProperty(source, node) ||
      !callableDeclarationAllowsSynchronousValue(source, node)
    ) {
      return;
    }
    const constructor = source.ast.parent(node);
    if (
      constructor !== undefined &&
      source.ast.is.IsConstructorDeclaration(constructor) &&
      source.ast.hasModifierKind(constructor, "private")
    ) {
      fields.add(node);
    }
  });
  return fields;
}
function collectCallableParameters(
  source: TargetSourceProgram,
): ReadonlyMap<Node, Node> {
  const parameters = new Map<Node, Node>();
  forEachProgramNode(source, (node) => {
    if (
      !source.ast.is.IsParameterDeclaration(node) ||
      isParameterProperty(source, node) ||
      !callableDeclarationAllowsSynchronousValue(source, node)
    ) {
      return;
    }
    const owner = source.ast.parent(node);
    if (
      owner !== undefined &&
      (source.ast.is.IsFunctionDeclaration(owner) ||
        source.ast.is.IsMethodDeclaration(owner)) &&
      source.ast.body(owner) !== undefined
    ) {
      parameters.set(node, owner);
    }
  });
  return parameters;
}

function collectInvocationInputs(
  source: TargetSourceProgram,
  invocation: Invocation,
  trackedParameters: ReadonlyMap<Node, Node>,
  trackedFields: ReadonlySet<Node>,
  parameterValues: Map<Node, Node[]>,
  fieldValues: Map<Node, Node[]>,
  invalidOwners: Set<Node>,
): void {
  const parameters = source.ast.parameters(invocation.declaration);
  if (
    invocation.arguments.some((argument) => source.ast.is.IsSpreadElement(argument)) ||
    parameters.some((parameter) =>
      source.ast.as.AsParameterDeclaration(parameter)?.DotDotDotToken !== undefined
    )
  ) {
    invalidOwners.add(invocation.declaration);
    return;
  }
  for (let index = 0; index < parameters.length; index += 1) {
    const parameter = parameters[index];
    const argument = invocation.arguments[index];
    if (parameter === undefined) {
      continue;
    }
    if (argument === undefined) {
      if (trackedParameters.has(parameter) || trackedFields.has(parameter)) {
        invalidOwners.add(invocation.declaration);
      }
      continue;
    }
    if (trackedParameters.has(parameter)) {
      append(parameterValues, parameter, argument);
    }
    if (trackedFields.has(parameter)) {
      append(fieldValues, parameter, argument);
    }
  }
}

function closeParameters(
  source: TargetSourceProgram,
  parameters: ReadonlyMap<Node, Node>,
  fields: ReadonlySet<Node>,
  invalidOwners: ReadonlySet<Node>,
): Set<Node> {
  const ownerCounts = new Map<Node, ReferenceCounts>();
  for (const owner of parameters.values()) {
    ownerCounts.set(owner, { total: 0, admitted: 0 });
  }
  const ownerSymbols = indexDeclarationSymbols(source, ownerCounts.keys());
  forEachProgramNode(source, (node) => {
    auditCallableOwnerReference(source, node, ownerCounts, ownerSymbols);
  });
  const closed = new Set<Node>();
  for (const [parameter, owner] of parameters) {
    const counts = ownerCounts.get(owner);
    if (
      !invalidOwners.has(owner) &&
      counts !== undefined &&
      counts.total === counts.admitted &&
      counts.admitted !== 0
    ) {
      closed.add(parameter);
    }
  }
  const uses = indexParameterUses(source, parameters.keys(), fields);
  let changed = true;
  while (changed) {
    changed = false;
    for (const parameter of [...closed]) {
      if (
        uses.invalid.has(parameter) ||
        [...(uses.dependencies.get(parameter) ?? [])].some(
          (dependency) => !closed.has(dependency),
        )
      ) {
        closed.delete(parameter);
        changed = true;
      }
    }
  }
  return closed;
}

function auditCallableOwnerReference(
  source: TargetSourceProgram,
  node: Node,
  tracked: ReadonlyMap<Node, ReferenceCounts>,
  trackedSymbols: ReadonlyMap<Symbol, Node>,
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
    isModuleForwardingReference(source, reference) ||
    isTypeOnlyReference(source, reference)
  ) {
    return;
  }
  counts.total += 1;
  const call = directContainingCall(source, reference);
  const selected = call === undefined
    ? undefined
    : source.semantics.forNode(call).getSignatureDeclaration(
        source.semantics.forNode(call).getResolvedSignature(call),
      );
  if (selected === declaration) {
    counts.admitted += 1;
  }
}

function auditFieldUse(
  source: TargetSourceProgram,
  node: Node,
  tracked: ReadonlyMap<Node, ReferenceCounts>,
  values: Map<Node, Node[]>,
  fields: ReadonlySet<Node>,
  closedParameters: ReadonlySet<Node>,
  closedAliases: ReadonlySet<Node>,
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
  if (
    selected?.accessMode === "read" &&
    !selected.optionalChain &&
    (directContainingCall(source, node) !== undefined ||
      isCallablePresenceObservation(source, node) ||
      isInitializerOfClosedAlias(source, node, closedAliases) ||
      trackedInputDestination(
          source,
          node,
          closedParameters,
          fields,
        ) !== undefined)
  ) {
    counts.admitted += 1;
  }
}

function invocationAt(
  source: TargetSourceProgram,
  node: Node,
): Invocation | undefined {
  if (
    !source.ast.is.IsCallExpression(node) &&
    !source.ast.is.IsNewExpression(node)
  ) {
    return undefined;
  }
  const semantics = source.semantics.forNode(node);
  const declaration = semantics.getSignatureDeclaration(
    semantics.getResolvedSignature(node),
  );
  return declaration === undefined
    ? undefined
    : {
        declaration,
        arguments: source.ast.arguments(node).filter(
          (argument): argument is Node => argument !== undefined,
        ),
      };
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

function isInitializerOfClosedAlias(
  source: TargetSourceProgram,
  expression: Node,
  aliases: ReadonlySet<Node>,
): boolean {
  let current = expression;
  for (;;) {
    const parent = source.ast.parent(current);
    if (parent === undefined) {
      return false;
    }
    if (isTransparentParent(source, parent, current)) {
      current = parent;
      continue;
    }
    return source.ast.is.IsVariableDeclaration(parent) &&
      source.ast.as.AsVariableDeclaration(parent)?.Initializer === current &&
      aliases.has(parent);
  }
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
