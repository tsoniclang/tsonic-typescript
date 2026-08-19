import type { Node, Type } from "@tsonic/tsts";
import {
  AsTypeReferenceNode,
  AsUnionTypeNode,
} from "@tsonic/tsts/target-ast";
import type {
  SourceFileSemantics,
  TargetSourceProgram,
} from "@tsonic/target-api";

import { sameSelectedType, typeMaySuspend } from "./synchronous.js";

export function callableDeclarationAllowsSynchronousValue(
  source: TargetSourceProgram,
  declaration: Node,
): boolean {
  return callableDeclarationSynchronousReturnTypes(source, declaration) !==
    undefined;
}

export function callableDeclarationHasResolvableType(
  source: TargetSourceProgram,
  declaration: Node,
): boolean {
  const typeNode = source.ast.typeNode(declaration);
  return typeNode !== undefined && callableTypeNodeIsResolvable(
    source,
    typeNode,
  ) === true;
}

export interface CallableReturnRewrite {
  readonly target: Node;
  readonly selection: CallableReturnSelection;
}

export type CallableReturnSelection =
  | { readonly kind: "type-argument"; readonly index: number }
  | { readonly kind: "union-member"; readonly index: number };

export function selectedCallableReturnType(
  source: TargetSourceProgram,
  target: Node,
  selection: CallableReturnSelection,
): Node | undefined {
  return selection.kind === "type-argument"
    ? source.ast.typeArguments(target)[selection.index]
    : AsUnionTypeNode(target)?.Types?.Nodes[selection.index];
}

export function callableResultReturnRewrites(
  source: TargetSourceProgram,
  declaration: Node,
): readonly CallableReturnRewrite[] | undefined {
  let resultType = source.ast.typeNode(declaration);
  if (resultType === undefined) {
    return undefined;
  }
  if (source.ast.hasModifierKind(declaration, "async")) {
    const outer = callableReturnRewrite(source, resultType);
    if (outer?.selection.kind !== "type-argument") {
      return undefined;
    }
    resultType = source.ast.typeArguments(resultType)[outer.selection.index];
    if (resultType === undefined) {
      return undefined;
    }
  }
  const result: CallableReturnRewrite[] = [];
  const callable = collectCallableResultRewrites(source, resultType, result);
  return callable === true ? Object.freeze(result) : undefined;
}

export function callableProjectedResultReturnRewrites(
  source: TargetSourceProgram,
  declaration: Node,
  index: number,
): readonly CallableReturnRewrite[] | undefined {
  let resultType = source.ast.typeNode(declaration);
  if (resultType === undefined) {
    return undefined;
  }
  if (source.ast.hasModifierKind(declaration, "async")) {
    const outer = callableReturnRewrite(source, resultType);
    if (outer?.selection.kind !== "type-argument") {
      return undefined;
    }
    resultType = source.ast.typeArguments(resultType)[outer.selection.index];
    if (resultType === undefined) {
      return undefined;
    }
  }
  const projected = fixedTupleElementType(source, resultType, index);
  if (projected === undefined) {
    return undefined;
  }
  const result: CallableReturnRewrite[] = [];
  const callable = collectCallableResultRewrites(source, projected, result);
  return callable === true ? Object.freeze(result) : undefined;
}

function fixedTupleElementType(
  source: TargetSourceProgram,
  node: Node,
  index: number,
): Node | undefined {
  let current = node;
  while (source.ast.is.IsParenthesizedTypeNode(current)) {
    const inner = source.ast.as.AsParenthesizedTypeNode(current)?.Type;
    if (inner === undefined) {
      return undefined;
    }
    current = inner;
  }
  if (
    source.ast.is.IsTypeOperatorNode(current) &&
    source.ast.operatorKindName(current) === "KindReadonlyKeyword"
  ) {
    const inner = source.ast.as.AsTypeOperatorNode(current)?.Type;
    if (inner === undefined) {
      return undefined;
    }
    current = inner;
  }
  if (!source.ast.is.IsTupleTypeNode(current)) {
    return undefined;
  }
  const selected = source.ast.elements(current)[index];
  if (selected === undefined) {
    return undefined;
  }
  if (source.ast.is.IsNamedTupleMember(selected)) {
    const named = source.ast.as.AsNamedTupleMember(selected);
    return named?.DotDotDotToken === undefined &&
        named?.QuestionToken === undefined
      ? named?.Type
      : undefined;
  }
  return source.ast.is.IsOptionalTypeNode(selected) ||
      source.ast.is.IsRestTypeNode(selected)
    ? undefined
    : selected;
}

function collectCallableResultRewrites(
  source: TargetSourceProgram,
  node: Node,
  result: CallableReturnRewrite[],
): boolean | undefined {
  if (source.ast.is.IsParenthesizedTypeNode(node)) {
    const inner = source.ast.as.AsParenthesizedTypeNode(node)?.Type;
    return inner === undefined
      ? undefined
      : collectCallableResultRewrites(source, inner, result);
  }
  if (source.ast.is.IsUnionTypeNode(node)) {
    const members = AsUnionTypeNode(node)?.Types?.Nodes ?? [];
    let callable = false;
    for (const member of members) {
      if (member === undefined) {
        return undefined;
      }
      const selected = collectCallableResultRewrites(source, member, result);
      if (selected === undefined) {
        return undefined;
      }
      callable ||= selected;
    }
    return callable;
  }
  const semantics = source.semantics.forNode(node);
  const selected = semantics.getTypeFromTypeNode(node);
  if (selected === undefined) {
    return undefined;
  }
  if (semantics.isNullish(selected)) {
    return false;
  }
  if (!source.ast.is.IsFunctionTypeNode(node)) {
    return undefined;
  }
  const returnType = source.ast.typeNode(node);
  if (returnType === undefined) {
    return undefined;
  }
  const returnSemantics = source.semantics.forNode(returnType);
  const selectedReturn = returnSemantics.getTypeFromTypeNode(returnType);
  if (selectedReturn === undefined) {
    return undefined;
  }
  const rewrite = callableReturnRewrite(source, returnType);
  if (
    rewrite !== undefined &&
    returnRewriteAdmitsDirectValue(source, rewrite)
  ) {
    result.push(rewrite);
    return true;
  }
  return !typeMaySuspend(returnSemantics, selectedReturn)
    ? true
    : undefined;
}

function returnRewriteAdmitsDirectValue(
  source: TargetSourceProgram,
  rewrite: CallableReturnRewrite,
): boolean {
  if (rewrite.selection.kind === "union-member") {
    return true;
  }
  const directNode = source.ast.typeArguments(rewrite.target)[
    rewrite.selection.index
  ];
  if (directNode === undefined) {
    return false;
  }
  const semantics = source.semantics.forNode(rewrite.target);
  const contract = semantics.getTypeFromTypeNode(rewrite.target);
  const direct = semantics.getTypeFromTypeNode(directNode);
  return contract !== undefined && direct !== undefined &&
    returnContractContainsDirectValue(semantics, contract, direct);
}

function returnContractContainsDirectValue(
  semantics: SourceFileSemantics,
  contract: Type,
  direct: Type,
): boolean {
  if (sameSelectedType(semantics, contract, direct)) {
    return true;
  }
  if (!semantics.isUnion(contract)) {
    return false;
  }
  const contractMembers = semantics.getUnionOrIntersectionTypes(contract);
  const directMembers = semantics.isUnion(direct)
    ? semantics.getUnionOrIntersectionTypes(direct)
    : [direct];
  return directMembers.every((directMember) =>
    directMember !== undefined && contractMembers.some((contractMember) =>
      contractMember !== undefined &&
      sameSelectedType(semantics, contractMember, directMember)
    )
  );
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
    return returnRewriteAdmitsDirectValue(source, rewrite);
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

export function callableDeclarationSynchronousReturnTypes(
  source: TargetSourceProgram,
  declaration: Node,
): readonly CallableReturnRewrite[] | undefined {
  const typeNode = source.ast.typeNode(declaration);
  const rewrites: CallableReturnRewrite[] = [];
  const callable = typeNode === undefined
    ? undefined
    : collectCallableResultRewrites(source, typeNode, rewrites);
  return callable === true && rewrites.length !== 0
    ? Object.freeze(rewrites)
    : undefined;
}

export function callableReturnRewrite(
  source: TargetSourceProgram,
  node: Node,
): CallableReturnRewrite | undefined {
  if (source.ast.is.IsParenthesizedTypeNode(node)) {
    const inner = source.ast.as.AsParenthesizedTypeNode(node)?.Type;
    return inner === undefined ? undefined : callableReturnRewrite(source, inner);
  }
  const semantics = source.semantics.forNode(node);
  if (source.ast.is.IsTypeReferenceNode(node)) {
    const arguments_ = source.ast.typeArguments(node);
    const innerNode = arguments_[0];
    const returnType = semantics.getTypeFromTypeNode(node);
    const innerType = innerNode === undefined
      ? undefined
      : semantics.getTypeFromTypeNode(innerNode);
    return arguments_.length === 1 &&
        returnType !== undefined &&
        innerType !== undefined &&
        typeMaySuspend(semantics, returnType) &&
        exactAwaitableContract(semantics, returnType, innerType)
      ? Object.freeze({
          target: node,
          selection: Object.freeze({ kind: "type-argument", index: 0 }),
        })
      : undefined;
  }
  if (!source.ast.is.IsUnionTypeNode(node)) {
    return undefined;
  }
  const members = AsUnionTypeNode(node)?.Types?.Nodes ?? [];
  const selected = members.map((member) =>
    member === undefined ? undefined : semantics.getTypeFromTypeNode(member)
  );
  const synchronous = selected.flatMap((type, index) =>
    type !== undefined && !typeMaySuspend(semantics, type) ? [index] : []
  );
  const index = synchronous[0];
  const innerType = index === undefined ? undefined : selected[index];
  return synchronous.length === 1 &&
      index !== undefined &&
      innerType !== undefined &&
      selected.every((type) =>
        type !== undefined &&
        exactAwaitableContract(semantics, type, innerType)
      )
    ? Object.freeze({
        target: node,
        selection: Object.freeze({ kind: "union-member", index }),
      })
    : undefined;
}

function exactAwaitableContract(
  semantics: SourceFileSemantics,
  type: Type,
  innerType: Type,
): boolean {
  if (sameSelectedType(semantics, type, innerType)) {
    return true;
  }
  if (semantics.isUnion(type)) {
    return exactAwaitableUnionContract(semantics, type, innerType);
  }
  return exactAwaitableWrapper(semantics, type, innerType);
}

function exactAwaitableUnionContract(
  semantics: SourceFileSemantics,
  contract: Type,
  direct: Type,
): boolean {
  const contractMembers = semantics.getUnionOrIntersectionTypes(contract);
  const directMembers = semantics.isUnion(direct)
    ? semantics.getUnionOrIntersectionTypes(direct)
    : [direct];
  if (
    contractMembers.some((member) => member === undefined) ||
    directMembers.some((member) => member === undefined)
  ) {
    return false;
  }
  const unmatchedDirect = new Set(directMembers.keys());
  let suspending = false;
  for (const member of contractMembers) {
    if (member === undefined) {
      return false;
    }
    const directIndex = [...unmatchedDirect].find((index) =>
      sameSelectedType(semantics, member, directMembers[index])
    );
    if (directIndex !== undefined) {
      unmatchedDirect.delete(directIndex);
      continue;
    }
    if (!exactAwaitableWrapper(semantics, member, direct)) {
      return false;
    }
    suspending = true;
  }
  return suspending && unmatchedDirect.size === 0;
}

function exactAwaitableWrapper(
  semantics: SourceFileSemantics,
  type: Type,
  direct: Type,
): boolean {
  if (!typeMaySuspend(semantics, type) || !semantics.isTypeReference(type)) {
    return false;
  }
  const arguments_ = semantics.getTypeArguments(type);
  return arguments_.length === 1 &&
    sameSelectedType(semantics, arguments_[0], direct);
}
