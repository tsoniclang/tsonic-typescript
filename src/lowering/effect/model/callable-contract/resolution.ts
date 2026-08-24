import type { Node, Type } from "@tsonic/tsts";
import {
  AsUnionTypeNode,
} from "@tsonic/tsts/target-ast";
import type {
  SourceFileSemantics,
  TargetSourceProgram,
} from "@tsonic/target-api/source";

import {
  callableReturnRewrite,
  callableReturnRewriteAdmitsDirectValue,
} from "../callable-contract.js";
import { typeMaySuspend } from "../synchronous.js";
import { typeHasDefinitelyNonThenableContract } from "../../../thenability.js";

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
  const type = semantics.types.authoredType(typeNode);
  if (
    type === undefined ||
    semantics.types.isAny(type) ||
    semantics.types.isUnknown(type)
  ) {
    return false;
  }
  const signatures = semantics.types.callSignatures(type);
  return signatures.length !== 0 && signatures.every((signature) => {
    const signatureDeclaration = semantics.declarations.signatureDeclaration(signature);
    const resultNode = signatureDeclaration === undefined
      ? undefined
      : source.ast.typeNode(signatureDeclaration);
    if (resultNode !== undefined) {
      return callableResultTypeIsResolvable(source, resultNode);
    }
    const result = semantics.types.returnType(signature);
    return result !== undefined && !typeMaySuspend(semantics, result);
  });
}

export function callableDeclarationHasExactCallableType(
  source: TargetSourceProgram,
  declaration: Node,
): boolean {
  const typeNode = source.ast.typeNode(declaration);
  const name = source.ast.name(declaration);
  const selected = typeNode ?? name;
  if (selected === undefined) {
    return false;
  }
  const semantics = source.semantics.forNode(selected);
  const type = typeNode === undefined
    ? semantics.types.expressionType(selected)
    : semantics.types.authoredType(typeNode);
  return type !== undefined && exactCallableType(semantics, type, new Set());
}

export function expressionHasExactCallableType(
  source: TargetSourceProgram,
  expression: Node,
): boolean {
  const semantics = source.semantics.forNode(expression);
  const type = semantics.types.expressionType(expression);
  return type !== undefined && exactCallableType(semantics, type, new Set());
}

function exactCallableType(
  semantics: SourceFileSemantics,
  type: Type,
  pending: Set<Type>,
): boolean {
  if (
    pending.has(type) ||
    semantics.types.isAny(type) ||
    semantics.types.isUnknown(type)
  ) {
    return false;
  }
  if (semantics.types.isUnion(type)) {
    pending.add(type);
    let callable = false;
    for (const member of semantics.types.unionOrIntersectionTypes(type)) {
      if (member === undefined) {
        pending.delete(type);
        return false;
      }
      if (semantics.types.isNullish(member)) {
        continue;
      }
      if (!exactCallableType(semantics, member, pending)) {
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
      const selected = semantics.types.authoredType(member);
      if (selected !== undefined && semantics.types.isNullish(selected)) {
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
  const selected = semantics.types.authoredType(node);
  return selected !== undefined &&
    (!typeMaySuspend(semantics, selected) ||
      typeHasDefinitelyNonThenableContract(source, semantics, selected));
}
