import type { Node, Type } from "@tsonic/tsts";
import type {
  SourceFileSemantics,
  TargetSourceProgram,
} from "@tsonic/target-api";

import type { InterfaceContractRelevance } from "./interface-contract-relevance.js";

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
  if (
    source.ast.is.IsBinaryExpression(node) &&
    source.ast.operatorKindName(node) === "KindEqualsToken"
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
  const sourceType = semantics.getTypeAtLocation(expression);
  if (sourceType === undefined) {
    return undefined;
  }
  const explicitTarget = explicitContextType(source, semantics, owner);
  if (
    !relevance.contains(semantics, sourceType) &&
    (explicitTarget === undefined ||
      !relevance.contains(semantics, explicitTarget))
  ) {
    return undefined;
  }
  const contextual = semantics.selectContextualValueType(expression);
  if (contextual.kind === "unavailable") {
    return undefined;
  }
  return Object.freeze({
    semantics,
    sourceType,
    targetTypes: Object.freeze(
      contextual.kind === "selected"
        ? [contextual.type]
        : [...contextual.types],
    ),
  });
}

function explicitContextType(
  source: TargetSourceProgram,
  semantics: SourceFileSemantics,
  owner: Node,
): Type | undefined {
  if (source.ast.is.IsBinaryExpression(owner)) {
    const left = source.ast.as.AsBinaryExpression(owner)?.Left;
    return left === undefined ? undefined : semantics.getTypeAtLocation(left);
  }
  if (source.ast.is.IsReturnStatement(owner)) {
    const callable = enclosingCallable(source, owner);
    const typeNode = source.ast.typeNode(callable);
    return typeNode === undefined
      ? undefined
      : semantics.getTypeFromTypeNode(typeNode);
  }
  const typeNode = source.ast.typeNode(owner);
  return typeNode === undefined
    ? undefined
    : semantics.getTypeFromTypeNode(typeNode);
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
