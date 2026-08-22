import type { Node, Symbol } from "@tsonic/tsts";
import type { TargetSourceProgram } from "@tsonic/target-api/source";

import type { CallableInputUseContract } from "../callable/input-use.js";
import type { ExactInvocationInputIndex } from "../invocation/inputs.js";
import {
  declarationForSymbols,
  isCallableNonEscapingObservation,
  trackedInputDestination,
  transportedCallableDestinations,
} from "../callable/input-reference.js";
import {
  directContainingCall,
  isModuleForwardingReference,
  isProjectDeclarationOnlyName,
} from "../../model/syntax.js";
import { resolveProjectInvocation } from "../../model/project-invocation.js";

export interface StorageReferenceCounts {
  total: number;
  admitted: number;
}

export function auditCallableOwnerReference(
  source: TargetSourceProgram,
  node: Node,
  tracked: ReadonlyMap<Node, StorageReferenceCounts>,
  trackedSymbols: ReadonlyMap<Symbol, Node>,
  ownerParameters: ReadonlyMap<Node, ReadonlySet<Node>>,
  storageDeclarations: ReadonlySet<Node>,
  storageSymbols: ReadonlyMap<Symbol, Node>,
  ownerDestinations: Map<Node, Set<Node>>,
  invocationInputs: ExactInvocationInputIndex,
  inputUses?: CallableInputUseContract,
  callableReferenceIsClosed?: (reference: Node) => boolean,
): void {
  let declaration: Node | undefined;
  let reference: Node | undefined;
  if (source.ast.is.IsPropertyAccessExpression(node)) {
    declaration = source.semantics.forNode(node)
      .operations.propertyAccess(node)?.selectedDeclaration;
    reference = node;
  } else if (source.ast.is.IsElementAccessExpression(node)) {
    declaration = source.semantics.forNode(node)
      .operations.elementAccess(node)?.selectedDeclaration;
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
    declaration === undefined ||
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
    inputUses?.useFor(reference) !== undefined ||
    callableReferenceIsClosed?.(reference) === true
  ) {
    counts.admitted += 1;
    return;
  }
  const destinations = new Set(invocationInputs.parametersFor(reference)
    ?.filter((parameter) => storageDeclarations.has(parameter)) ?? []);
  const storageDestination = trackedInputDestination(
    source,
    reference,
    storageDeclarations,
    storageSymbols,
  );
  if (storageDestination !== undefined) {
    destinations.add(storageDestination);
  }
  if (destinations.size !== 0) {
    counts.admitted += 1;
    for (const parameter of ownerParameters.get(declaration) ?? []) {
      for (const destination of destinations) {
        appendSet(ownerDestinations, parameter, destination);
      }
    }
  }
}

export function auditFieldUse(
  source: TargetSourceProgram,
  node: Node,
  tracked: ReadonlyMap<Node, StorageReferenceCounts>,
  values: Map<Node, Node[]>,
  fields: ReadonlySet<Node>,
  storageDeclarations: ReadonlySet<Node>,
  storageSymbols: ReadonlyMap<Symbol, Node>,
  destinations: Map<Node, Set<Node>>,
  inputUses?: CallableInputUseContract,
  invocationInputs?: ExactInvocationInputIndex,
  callableReferenceIsClosed?: (reference: Node) => boolean,
): void {
  const selected = source.ast.is.IsPropertyAccessExpression(node)
    ? source.semantics.forNode(node).operations.propertyAccess(node)
    : source.ast.is.IsElementAccessExpression(node)
    ? source.semantics.forNode(node).operations.elementAccess(node)
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
  const invocationDestinations = invocationInputs?.parametersFor(node)
    ?.filter((parameter) => storageDeclarations.has(parameter)) ?? [];
  if (
    directContainingCall(source, node) !== undefined ||
    callableReferenceIsClosed?.(node) === true ||
    isCallableNonEscapingObservation(source, node) ||
    destination !== undefined ||
    transported !== undefined ||
    invocationDestinations.length !== 0
  ) {
    counts.admitted += 1;
    if (destination !== undefined) {
      appendSet(destinations, field, destination);
    }
    for (const transportedDestination of transported ?? []) {
      appendSet(destinations, field, transportedDestination);
    }
    for (const invocationDestination of invocationDestinations) {
      appendSet(destinations, field, invocationDestination);
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
