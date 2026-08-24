import type { Node, Type } from "@tsonic/tsts";
import type {
  SourceFileSemantics,
  TargetSourceProgram,
} from "@tsonic/target-api/source";

import type { InterfaceContractRelevance } from "./relevance.js";
import { isExactValueAssignmentOperator } from "../storage/assignment.js";

export interface InterfaceContractContext {
  readonly semantics: SourceFileSemantics;
  readonly sourceType: Type;
  readonly targetTypes: readonly Type[];
}

export function contextualExpression(
  source: TargetSourceProgram,
  node: Node,
): Node | undefined {
  if (source.ast.is.IsVariableDeclaration(node)) {
    return source.ast.as.AsVariableDeclaration(node)?.Initializer;
  }
  if (source.ast.is.IsPropertyDeclaration(node)) {
    return source.ast.as.AsPropertyDeclaration(node)?.Initializer;
  }
  if (source.ast.is.IsParameterDeclaration(node)) {
    return source.ast.as.AsParameterDeclaration(node)?.Initializer;
  }
  if (source.ast.is.IsReturnStatement(node)) {
    return source.ast.as.AsReturnStatement(node)?.Expression;
  }
  if (source.ast.is.IsAsExpression(node)) {
    return source.ast.as.AsAsExpression(node)?.Expression;
  }
  if (source.ast.is.IsTypeAssertion(node)) {
    return source.ast.as.AsTypeAssertion(node)?.Expression;
  }
  if (source.ast.is.IsSatisfiesExpression(node)) {
    return source.ast.as.AsSatisfiesExpression(node)?.Expression;
  }
  if (
    source.ast.is.IsBinaryExpression(node) &&
    isExactValueAssignmentOperator(source.ast.operatorKindName(node))
  ) {
    return source.ast.as.AsBinaryExpression(node)?.Right;
  }
  return undefined;
}

export function selectInterfaceContractContext(
  source: TargetSourceProgram,
  owner: Node,
  expression: Node,
  relevance: InterfaceContractRelevance,
): InterfaceContractContext | undefined {
  const semantics = source.semantics.forNode(expression);
  const sourceType = semantics.types.expressionType(expression);
  if (sourceType === undefined) {
    return undefined;
  }
  const explicitTargets = explicitContextTypes(source, semantics, owner);
  if (
    !relevance.contains(semantics, sourceType) &&
    !explicitTargets.some((target) => relevance.contains(semantics, target))
  ) {
    return undefined;
  }
  const contextual = semantics.types.contextualValueSelection(expression);
  const targetTypes = contextual.kind === "unavailable"
    ? explicitTargets
    : contextual.kind === "selected"
    ? [contextual.type]
    : [...contextual.types];
  const selectedTargets = uniqueTypes([...explicitTargets, ...targetTypes]);
  if (selectedTargets.length === 0) {
    return undefined;
  }
  return Object.freeze({
    semantics,
    sourceType,
    targetTypes: Object.freeze(selectedTargets),
  });
}

function explicitContextTypes(
  source: TargetSourceProgram,
  semantics: SourceFileSemantics,
  owner: Node,
): readonly Type[] {
  if (source.ast.is.IsBinaryExpression(owner)) {
    const left = source.ast.as.AsBinaryExpression(owner)?.Left;
    const type = left === undefined ? undefined : semantics.types.expressionType(left);
    return type === undefined ? [] : [type];
  }
  if (source.ast.is.IsReturnStatement(owner)) {
    const callable = enclosingCallable(source, owner);
    return callable === undefined
      ? []
      : callableResultTypes(source, semantics, callable);
  }
  if (
    source.ast.is.IsArrowFunction(owner) ||
    source.ast.is.IsFunctionExpression(owner)
  ) {
    return callableResultTypes(source, semantics, owner);
  }
  const typeNode = source.ast.typeNode(owner);
  const type = typeNode === undefined
    ? undefined
    : semantics.types.authoredType(typeNode);
  return type === undefined ? [] : [type];
}

function callableResultTypes(
  source: TargetSourceProgram,
  semantics: SourceFileSemantics,
  callable: Node,
): readonly Type[] {
  const typeNode = source.ast.typeNode(callable);
  const authored = typeNode === undefined
    ? undefined
    : semantics.types.authoredType(typeNode);
  if (authored !== undefined) {
    return [authored];
  }
  const name = source.ast.name(callable);
  const callableType = semantics.types.expressionType(name ?? callable);
  if (callableType === undefined) {
    return [];
  }
  const signatures = semantics.types.callSignatures(callableType);
  const results = signatures.map((signature) =>
    semantics.types.returnType(signature)
  );
  return signatures.length !== 0 && results.every((type) => type !== undefined)
    ? uniqueTypes(results as readonly Type[])
    : [];
}

function uniqueTypes(types: readonly Type[]): Type[] {
  return types.filter((type, index) => types.indexOf(type) === index);
}

function enclosingCallable(
  source: TargetSourceProgram,
  node: Node,
): Node | undefined {
  let current = source.ast.parent(node);
  while (current !== undefined) {
    if (
      source.ast.is.IsFunctionDeclaration(current) ||
      source.ast.is.IsMethodDeclaration(current) ||
      source.ast.is.IsFunctionExpression(current) ||
      source.ast.is.IsArrowFunction(current) ||
      source.ast.is.IsGetAccessorDeclaration(current) ||
      source.ast.is.IsSetAccessorDeclaration(current)
    ) {
      return current;
    }
    current = source.ast.parent(current);
  }
  return undefined;
}
