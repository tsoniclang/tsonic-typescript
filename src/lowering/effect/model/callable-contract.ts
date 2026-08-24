import type { Node, Symbol, Type } from "@tsonic/tsts";
import {
  AsTypeReferenceNode,
  AsUnionTypeNode,
} from "@tsonic/tsts/target-ast";
import type {
  SourceFileSemantics,
  TargetSourceProgram,
} from "@tsonic/target-api/source";

import { sameSelectedType, typeMaySuspend } from "./synchronous.js";
import { nodeHasExactSourceSemantics } from "./source-membership.js";

export function callableDeclarationDirectReturnRewrite(
  source: TargetSourceProgram,
  declaration: Node,
): CallableReturnRewrite | undefined {
  if (!nodeHasExactSourceSemantics(source, declaration)) {
    return undefined;
  }
  const returnType = source.ast.typeNode(declaration);
  const rewrite = returnType === undefined
    ? undefined
    : callableReturnRewrite(source, returnType);
  return rewrite !== undefined &&
      callableReturnRewriteAdmitsDirectValue(source, rewrite)
    ? rewrite
    : undefined;
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
  if (!nodeHasExactSourceSemantics(source, declaration)) {
    return undefined;
  }
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

export type CallableProjectedResultSlot =
  | {
      readonly kind: "element";
      readonly index: number;
    }
  | {
      readonly kind: "property";
      readonly symbols: ReadonlySet<Symbol>;
      readonly declarations: ReadonlySet<Node>;
    };

export function callableProjectedResultSlotReturnRewrites(
  source: TargetSourceProgram,
  declaration: Node,
  path: readonly CallableProjectedResultSlot[],
): readonly CallableReturnRewrite[] | undefined {
  if (
    path.length === 0 ||
    !nodeHasExactSourceSemantics(source, declaration)
  ) {
    return undefined;
  }
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
  const projected = projectCallableResultSlot(source, resultType, path);
  if (projected === undefined || projected.length === 0) {
    return undefined;
  }
  const rewrites: CallableReturnRewrite[] = [];
  for (const node of projected) {
    if (collectCallableResultRewrites(source, node, rewrites) !== true) {
      return undefined;
    }
  }
  return Object.freeze(rewrites);
}

function projectCallableResultSlot(
  source: TargetSourceProgram,
  node: Node,
  path: readonly CallableProjectedResultSlot[],
): readonly Node[] | undefined {
  const [step, ...remaining] = path;
  if (step === undefined) {
    return Object.freeze([node]);
  }
  const selected = unwrapProjectedResultContainer(source, node);
  if (selected === undefined) {
    return undefined;
  }
  if (source.ast.is.IsUnionTypeNode(selected)) {
    const result: Node[] = [];
    for (const member of AsUnionTypeNode(selected)?.Types?.Nodes ?? []) {
      if (member === undefined) {
        return undefined;
      }
      const semantics = source.semantics.forNode(member);
      const type = semantics.types.authoredType(member);
      if (type !== undefined && semantics.types.isNullish(type)) {
        continue;
      }
      const projected = projectCallableResultSlot(source, member, path);
      if (projected === undefined) {
        return undefined;
      }
      result.push(...projected);
    }
    return result.length === 0 ? undefined : Object.freeze(result);
  }
  const child = step.kind === "element"
    ? fixedTupleElementType(source, selected, step.index)
    : exactInlinePropertyType(source, selected, step);
  return child === undefined
    ? undefined
    : projectCallableResultSlot(source, child, remaining);
}

function unwrapProjectedResultContainer(
  source: TargetSourceProgram,
  node: Node,
): Node | undefined {
  let current = node;
  for (;;) {
    if (source.ast.is.IsParenthesizedTypeNode(current)) {
      const inner = source.ast.as.AsParenthesizedTypeNode(current)?.Type;
      if (inner === undefined) {
        return undefined;
      }
      current = inner;
      continue;
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
      continue;
    }
    return current;
  }
}

function exactInlinePropertyType(
  source: TargetSourceProgram,
  node: Node,
  selector: Extract<
    CallableProjectedResultSlot,
    { readonly kind: "property" }
  >,
): Node | undefined {
  if (!source.ast.is.IsTypeLiteralNode(node)) {
    return undefined;
  }
  const matches = source.ast.elements(node).filter((member) => {
    if (member === undefined) {
      return false;
    }
    const name = source.ast.name(member);
    if (name === undefined) {
      return false;
    }
    const semantics = source.semantics.forNode(name);
    const symbol = source.navigation.sourceReferenceFor(name)?.symbol;
    const symbols = symbol === undefined ? [] : [symbol];
    const declarations = symbols.flatMap((symbol) =>
      semantics.declarations.symbolDeclarations(symbol).filter(
        (declaration): declaration is Node => declaration !== undefined,
      )
    );
    return symbols.some((symbol) => selector.symbols.has(symbol)) ||
      declarations.some((declaration) =>
        selector.declarations.has(declaration)
      ) || selector.declarations.has(member);
  });
  if (matches.length !== 1) {
    return undefined;
  }
  const member = matches[0]!;
  return source.ast.is.IsPropertySignatureDeclaration(member)
    ? source.ast.typeNode(member)
    : undefined;
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

export function collectCallableResultRewrites(
  source: TargetSourceProgram,
  node: Node,
  result: CallableReturnRewrite[],
  pendingAliases: ReadonlySet<Node> = new Set(),
): boolean | undefined {
  if (source.ast.is.IsParenthesizedTypeNode(node)) {
    const inner = source.ast.as.AsParenthesizedTypeNode(node)?.Type;
    return inner === undefined
      ? undefined
      : collectCallableResultRewrites(source, inner, result, pendingAliases);
  }
  if (source.ast.is.IsUnionTypeNode(node)) {
    const members = AsUnionTypeNode(node)?.Types?.Nodes ?? [];
    let callable = false;
    for (const member of members) {
      if (member === undefined) {
        return undefined;
      }
      const selected = collectCallableResultRewrites(
        source,
        member,
        result,
        pendingAliases,
      );
      if (selected === undefined) {
        return undefined;
      }
      callable ||= selected;
    }
    return callable;
  }
  const semantics = source.semantics.forNode(node);
  const selected = semantics.types.authoredType(node);
  if (selected === undefined) {
    return undefined;
  }
  if (semantics.types.isNullish(selected)) {
    return false;
  }
  if (source.ast.is.IsTypeReferenceNode(node)) {
    const typeName = AsTypeReferenceNode(node)?.TypeName;
    const declaration = source.navigation.sourceReferenceFor(typeName)
      ?.declaration;
    if (
      declaration === undefined ||
      !source.ast.is.IsTypeAliasDeclaration(declaration) ||
      pendingAliases.has(declaration)
    ) {
      return undefined;
    }
    const aliasType = source.ast.typeNode(declaration);
    if (aliasType === undefined) {
      return undefined;
    }
    return collectCallableResultRewrites(
      source,
      aliasType,
      result,
      new Set([...pendingAliases, declaration]),
    );
  }
  if (!source.ast.is.IsFunctionTypeNode(node)) {
    return undefined;
  }
  const returnType = source.ast.typeNode(node);
  if (returnType === undefined) {
    return undefined;
  }
  const returnSemantics = source.semantics.forNode(returnType);
  const selectedReturn = returnSemantics.types.authoredType(returnType);
  if (selectedReturn === undefined) {
    return undefined;
  }
  const rewrite = callableReturnRewrite(source, returnType);
  if (
    rewrite !== undefined &&
    callableReturnRewriteAdmitsDirectValue(source, rewrite)
  ) {
    result.push(rewrite);
    return true;
  }
  return !typeMaySuspend(returnSemantics, selectedReturn)
    ? true
    : undefined;
}

export function callableReturnRewriteAdmitsDirectValue(
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
  const contract = semantics.types.authoredType(rewrite.target);
  const direct = semantics.types.authoredType(directNode);
  return contract !== undefined && direct !== undefined &&
    returnContractContainsDirectValue(semantics, contract, direct);
}

export function callableResultTypeAllowsSynchronousValue(
  semantics: SourceFileSemantics,
  type: Type,
): boolean {
  if (!typeMaySuspend(semantics, type)) {
    return true;
  }
  if (!semantics.types.isUnion(type)) {
    return false;
  }
  const candidates = semantics.types.unionOrIntersectionTypes(type);
  for (const candidate of candidates) {
    if (
      candidate === undefined ||
      !typeMaySuspend(semantics, candidate) ||
      !semantics.types.isTypeReference(candidate)
    ) {
      continue;
    }
    const arguments_ = semantics.types.effectiveTypeArguments(candidate);
    const direct = arguments_?.length === 1 ? arguments_[0] : undefined;
    if (
      direct !== undefined &&
      exactAwaitableContract(semantics, type, direct)
    ) {
      return true;
    }
  }
  return false;
}

function returnContractContainsDirectValue(
  semantics: SourceFileSemantics,
  contract: Type,
  direct: Type,
): boolean {
  if (sameSelectedType(semantics, contract, direct)) {
    return true;
  }
  if (!semantics.types.isUnion(contract)) {
    return false;
  }
  const contractMembers = semantics.types.unionOrIntersectionTypes(contract);
  const directMembers = semantics.types.isUnion(direct)
    ? semantics.types.unionOrIntersectionTypes(direct)
    : [direct];
  return directMembers.every((directMember) =>
    directMember !== undefined && contractMembers.some((contractMember) =>
      contractMember !== undefined &&
      sameSelectedType(semantics, contractMember, directMember)
    )
  );
}

export function callableReturnRewrite(
  source: TargetSourceProgram,
  node: Node,
): CallableReturnRewrite | undefined {
  if (!nodeHasExactSourceSemantics(source, node)) {
    return undefined;
  }
  if (source.ast.is.IsParenthesizedTypeNode(node)) {
    const inner = source.ast.as.AsParenthesizedTypeNode(node)?.Type;
    return inner === undefined ? undefined : callableReturnRewrite(source, inner);
  }
  const semantics = source.semantics.forNode(node);
  if (source.ast.is.IsTypeReferenceNode(node)) {
    const arguments_ = source.ast.typeArguments(node);
    const innerNode = arguments_[0];
    const returnType = semantics.types.authoredType(node);
    const innerType = innerNode === undefined
      ? undefined
      : semantics.types.authoredType(innerNode);
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
    member === undefined ? undefined : semantics.types.authoredType(member)
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
  if (semantics.types.isUnion(type)) {
    return exactAwaitableUnionContract(semantics, type, innerType);
  }
  return exactAwaitableWrapper(semantics, type, innerType);
}

function exactAwaitableUnionContract(
  semantics: SourceFileSemantics,
  contract: Type,
  direct: Type,
): boolean {
  const contractMembers = semantics.types.unionOrIntersectionTypes(contract);
  const directMembers = semantics.types.isUnion(direct)
    ? semantics.types.unionOrIntersectionTypes(direct)
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
  if (!typeMaySuspend(semantics, type) || !semantics.types.isTypeReference(type)) {
    return false;
  }
  const arguments_ = semantics.types.effectiveTypeArguments(type);
  if (arguments_ === undefined) {
    return false;
  }
  return arguments_.length === 1 &&
    sameSelectedType(semantics, arguments_[0], direct);
}
