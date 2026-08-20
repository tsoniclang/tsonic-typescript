import type { Node } from "@tsonic/tsts";
import {
  AsTypeReferenceNode,
  AsUnionTypeNode,
} from "@tsonic/tsts/target-ast";
import type { TargetSourceProgram } from "@tsonic/target-api";

import {
  callableReturnRewrite,
  callableReturnRewriteAdmitsDirectValue,
} from "../callable-contract.js";
import { typeMaySuspend } from "../synchronous.js";

export function callableDeclarationHasResolvableType(
  source: TargetSourceProgram,
  declaration: Node,
): boolean {
  const typeNode = source.ast.typeNode(declaration);
  if (typeNode === undefined) {
    return false;
  }
  if (callableTypeNodeIsResolvable(source, typeNode) === true) {
    return true;
  }
  const semantics = source.semantics.forNode(typeNode);
  const type = semantics.getTypeFromTypeNode(typeNode);
  if (
    type === undefined ||
    semantics.isAny(type) ||
    semantics.isUnknown(type) ||
    semantics.couldContainTypeVariables(type)
  ) {
    return false;
  }
  const signatures = semantics.getCallSignatures(type);
  return signatures.length !== 0 && signatures.every((signature) => {
    const signatureDeclaration = semantics.getSignatureDeclaration(signature);
    const resultNode = signatureDeclaration === undefined
      ? undefined
      : source.ast.typeNode(signatureDeclaration);
    if (resultNode !== undefined) {
      return callableResultTypeIsResolvable(source, resultNode);
    }
    const result = semantics.getReturnTypeOfSignature(signature);
    return result !== undefined && !typeMaySuspend(semantics, result);
  });
}

function callableTypeNodeIsResolvable(
  source: TargetSourceProgram,
  node: Node,
): boolean | undefined {
  if (source.ast.is.IsParenthesizedTypeNode(node)) {
    const inner = source.ast.as.AsParenthesizedTypeNode(node)?.Type;
    return inner === undefined
      ? undefined
      : callableTypeNodeIsResolvable(source, inner);
  }
  if (source.ast.is.IsUnionTypeNode(node)) {
    let callable = false;
    for (const member of AsUnionTypeNode(node)?.Types?.Nodes ?? []) {
      if (member === undefined) {
        return undefined;
      }
      const semantics = source.semantics.forNode(member);
      const selected = semantics.getTypeFromTypeNode(member);
      if (selected !== undefined && semantics.isNullish(selected)) {
        continue;
      }
      const exact = callableTypeNodeIsResolvable(source, member);
      if (exact !== true) {
        return undefined;
      }
      callable = true;
    }
    return callable;
  }
  if (!source.ast.is.IsFunctionTypeNode(node)) {
    return undefined;
  }
  const returnType = source.ast.typeNode(node);
  return returnType !== undefined && callableResultTypeIsResolvable(
      source,
      returnType,
    )
    ? true
    : undefined;
}

function callableResultTypeIsResolvable(
  source: TargetSourceProgram,
  node: Node,
): boolean {
  const rewrite = callableReturnRewrite(source, node);
  if (rewrite !== undefined) {
    return callableReturnRewriteAdmitsDirectValue(source, rewrite);
  }
  const semantics = source.semantics.forNode(node);
  const selected = semantics.getTypeFromTypeNode(node);
  return selected !== undefined &&
    (!typeMaySuspend(semantics, selected) ||
      isExactTypeParameterReference(source, node));
}

function isExactTypeParameterReference(
  source: TargetSourceProgram,
  node: Node,
): boolean {
  const name = AsTypeReferenceNode(node)?.TypeName;
  if (name === undefined) {
    return false;
  }
  const semantics = source.semantics.forNode(name);
  const symbol = semantics.getResolvedSymbol(name) ??
    semantics.getSymbolAtLocation(name);
  const declarations = semantics.getSymbolDeclarations(symbol);
  return declarations.length !== 0 && declarations.every((declaration) =>
    source.ast.is.IsTypeParameterDeclaration(declaration)
  );
}
