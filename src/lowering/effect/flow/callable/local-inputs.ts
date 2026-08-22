import type { Node, Symbol, Type } from "@tsonic/tsts";
import type {
  SourceFileSemantics,
  TargetSourceProgram,
} from "@tsonic/target-api/source";
import { KindVariableDeclaration } from "@tsonic/tsts/target-ast";

import type { TargetProgramIndex } from "../../../program-index.js";
import type { CallableInputUseContract } from "./input-use.js";
import type { ExactInvocationInputIndex } from "../invocation/inputs.js";

import { callableDeclarationAllowsSynchronousValue } from "../../model/callable-contract.js";
import {
  isCallableNonEscapingObservation,
  trackedInputDestination,
  transportedCallableDestinations,
} from "./input-reference.js";
import {
  directContainingCall,
  isModuleForwardingReference,
} from "../../model/syntax.js";

interface ReferenceCounts {
  total: number;
  admitted: number;
}

export function collectCallableLocals(
  source: TargetSourceProgram,
  excluded: ReadonlySet<Node>,
  program: TargetProgramIndex,
): Map<Node, Node[]> {
  const locals = new Map<Node, Node[]>();
  for (const node of program.nodesOfKind(KindVariableDeclaration)) {
    const name = source.ast.name(node);
    const initializer = source.ast.is.IsVariableDeclaration(node)
      ? source.ast.as.AsVariableDeclaration(node)?.Initializer
      : undefined;
    const semantics = name === undefined
      ? undefined
      : source.semantics.forNode(name);
    const type = semantics === undefined || name === undefined
      ? undefined
      : semantics.types.expressionType(name);
    const inferredImmutableCallable =
      source.ast.variableDeclarationKind(node) === "const" &&
      initializer !== undefined &&
      semantics !== undefined &&
      type !== undefined &&
      !semantics.types.isAny(type) &&
      !semantics.types.isUnknown(type) &&
      inferredTypeIsCallable(semantics, type, new Set());
    if (
      !source.ast.is.IsIdentifier(name) ||
      excluded.has(node) ||
      (!callableDeclarationAllowsSynchronousValue(source, node) &&
        !inferredImmutableCallable)
    ) {
      continue;
    }
    locals.set(node, initializer === undefined ? [] : [initializer]);
  }
  return locals;
}

function inferredTypeIsCallable(
  semantics: SourceFileSemantics,
  type: Type,
  pending: Set<Type>,
): boolean {
  if (
    pending.has(type) ||
    semantics.types.isAny(type) ||
    semantics.types.isUnknown(type) ||
    semantics.types.isNullish(type)
  ) {
    return false;
  }
  if (semantics.types.isUnion(type)) {
    pending.add(type);
    let callable = false;
    for (const member of semantics.types.unionOrIntersectionTypes(type)) {
      if (member === undefined || semantics.types.isNullish(member)) {
        continue;
      }
      if (!inferredTypeIsCallable(semantics, member, pending)) {
        pending.delete(type);
        return false;
      }
      callable = true;
    }
    pending.delete(type);
    return callable;
  }
  return semantics.types.callSignatures(type).length !== 0;
}

export function auditCallableLocalUse(
  source: TargetSourceProgram,
  reference: Node,
  local: Node,
  counts: ReferenceCounts,
  values: Map<Node, Node[]>,
  storageDeclarations: ReadonlySet<Node>,
  storageSymbols: ReadonlyMap<Symbol, Node>,
  destinations: Map<Node, Set<Node>>,
  inputUses?: CallableInputUseContract,
  invocationInputs?: ExactInvocationInputIndex,
  callableReferenceIsClosed?: (reference: Node) => boolean,
): void {
  if (!source.ast.is.IsIdentifier(reference)) {
    return;
  }
  if (
    reference === source.ast.name(local) ||
    isModuleForwardingReference(source, reference) ||
    isTypeOnlyReference(source, reference)
  ) {
    return;
  }
  counts.total += 1;
  const assigned = exactAssignedValue(source, reference);
  if (assigned !== undefined) {
    append(values, local, assigned);
    counts.admitted += 1;
    return;
  }
  const destination = trackedInputDestination(
    source,
    reference,
    storageDeclarations,
    storageSymbols,
  );
  const transported = transportedCallableDestinations(
    source,
    reference,
    storageDeclarations,
    storageSymbols,
    inputUses,
  );
  const invocationDestinations = invocationInputs?.parametersFor(reference)
    ?.filter((parameter) => storageDeclarations.has(parameter)) ?? [];
  if (
    directContainingCall(source, reference) !== undefined ||
    callableReferenceIsClosed?.(reference) === true ||
    isCallableNonEscapingObservation(source, reference) ||
    destination !== undefined ||
    transported !== undefined ||
    invocationDestinations.length !== 0
  ) {
    counts.admitted += 1;
    if (destination !== undefined) {
      appendSet(destinations, local, destination);
    }
    for (const transportedDestination of transported ?? []) {
      appendSet(destinations, local, transportedDestination);
    }
    for (const invocationDestination of invocationDestinations) {
      appendSet(destinations, local, invocationDestination);
    }
  }
}

function exactAssignedValue(
  source: TargetSourceProgram,
  reference: Node,
): Node | undefined {
  const parent = source.ast.parent(reference);
  if (
    parent === undefined ||
    !source.ast.is.IsBinaryExpression(parent) ||
    source.ast.operatorKindName(parent) !== "KindEqualsToken" ||
    source.ast.as.AsBinaryExpression(parent)?.Left !== reference
  ) {
    return undefined;
  }
  return source.ast.as.AsBinaryExpression(parent)?.Right;
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
