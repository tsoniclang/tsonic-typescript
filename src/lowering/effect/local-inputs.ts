import type { Node, Symbol, Type } from "@tsonic/tsts";
import type {
  SourceFileSemantics,
  TargetSourceProgram,
} from "@tsonic/target-api";

import { callableDeclarationAllowsSynchronousValue } from "./callable-contract.js";
import {
  declarationForSymbols,
  isCallablePresenceObservation,
  trackedInputDestination,
} from "./callable-input-reference.js";
import {
  directContainingCall,
  forEachProgramNode,
  isModuleForwardingReference,
} from "./syntax.js";

interface ReferenceCounts {
  total: number;
  admitted: number;
}

export function collectCallableLocals(
  source: TargetSourceProgram,
  excluded: ReadonlySet<Node>,
): Map<Node, Node[]> {
  const locals = new Map<Node, Node[]>();
  forEachProgramNode(source, (node) => {
    const name = source.ast.name(node);
    const initializer = source.ast.is.IsVariableDeclaration(node)
      ? source.ast.as.AsVariableDeclaration(node)?.Initializer
      : undefined;
    const semantics = name === undefined
      ? undefined
      : source.semantics.forNode(name);
    const type = semantics?.getTypeAtLocation(name);
    const inferredImmutableCallable =
      source.ast.variableDeclarationKind(node) === "const" &&
      initializer !== undefined &&
      semantics !== undefined &&
      type !== undefined &&
      !semantics.isAny(type) &&
      !semantics.isUnknown(type) &&
      inferredTypeIsCallable(semantics, type, new Set());
    if (
      !source.ast.is.IsVariableDeclaration(node) ||
      !source.ast.is.IsIdentifier(name) ||
      excluded.has(node) ||
      (!callableDeclarationAllowsSynchronousValue(source, node) &&
        !inferredImmutableCallable)
    ) {
      return;
    }
    locals.set(node, initializer === undefined ? [] : [initializer]);
  });
  return locals;
}

function inferredTypeIsCallable(
  semantics: SourceFileSemantics,
  type: Type,
  pending: Set<Type>,
): boolean {
  if (
    pending.has(type) ||
    semantics.isAny(type) ||
    semantics.isUnknown(type) ||
    semantics.isNullish(type)
  ) {
    return false;
  }
  if (semantics.isUnion(type)) {
    pending.add(type);
    let callable = false;
    for (const member of semantics.getUnionOrIntersectionTypes(type)) {
      if (member === undefined || semantics.isNullish(member)) {
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
  return semantics.getCallSignatures(type).length !== 0;
}

export function auditCallableLocalUse(
  source: TargetSourceProgram,
  node: Node,
  tracked: ReadonlyMap<Node, ReferenceCounts>,
  values: Map<Node, Node[]>,
  storageDeclarations: ReadonlySet<Node>,
  storageSymbols: ReadonlyMap<Symbol, Node>,
  destinations: Map<Node, Set<Node>>,
): void {
  if (!source.ast.is.IsIdentifier(node)) {
    return;
  }
  const local = declarationForSymbols(source, storageSymbols, node);
  const counts = local === undefined ? undefined : tracked.get(local);
  if (
    local === undefined ||
    counts === undefined ||
    node === source.ast.name(local) ||
    isModuleForwardingReference(source, node) ||
    isTypeOnlyReference(source, node)
  ) {
    return;
  }
  counts.total += 1;
  const assigned = exactAssignedValue(source, node);
  if (assigned !== undefined) {
    append(values, local, assigned);
    counts.admitted += 1;
    return;
  }
  const destination = trackedInputDestination(
    source,
    node,
    storageDeclarations,
    storageSymbols,
  );
  if (
    directContainingCall(source, node) !== undefined ||
    isCallablePresenceObservation(source, node) ||
    destination !== undefined
  ) {
    counts.admitted += 1;
    if (destination !== undefined) {
      appendSet(destinations, local, destination);
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
