import type { Node, Type } from "@tsonic/tsts";
import { AsUnionTypeNode } from "@tsonic/tsts/target-ast";
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

export interface CallableReturnRewrite {
  readonly target: Node;
  readonly selection:
    | { readonly kind: "type-argument"; readonly index: number }
    | { readonly kind: "union-member"; readonly index: number };
}

export function callableDeclarationSynchronousReturnTypes(
  source: TargetSourceProgram,
  declaration: Node,
): readonly CallableReturnRewrite[] | undefined {
  const name = source.ast.name(declaration);
  const semantics = source.semantics.forNode(name ?? declaration);
  const type = semantics.getTypeAtLocation(name ?? declaration);
  if (
    type === undefined ||
    !callableTypeAllowsSynchronousValue(semantics, type, new Set())
  ) {
    return undefined;
  }
  const returnTypes = callableReturnTypeNodes(
    source,
    source.ast.typeNode(declaration),
  );
  const rewrites = returnTypes.map((returnType) =>
    callableReturnRewrite(source, returnType)
  );
  return rewrites.length !== 0 && rewrites.every(isReturnRewrite)
    ? Object.freeze(rewrites)
    : undefined;
}

function isReturnRewrite(
  rewrite: CallableReturnRewrite | undefined,
): rewrite is CallableReturnRewrite {
  return rewrite !== undefined;
}

function callableReturnTypeNodes(
  source: TargetSourceProgram,
  node: Node | undefined,
): Node[] {
  if (node === undefined) {
    return [];
  }
  if (source.ast.is.IsParenthesizedTypeNode(node)) {
    return callableReturnTypeNodes(
      source,
      source.ast.as.AsParenthesizedTypeNode(node)?.Type,
    );
  }
  if (source.ast.is.IsUnionTypeNode(node)) {
    return source.ast.children(node).flatMap((child) =>
      callableReturnTypeNodes(source, child)
    );
  }
  if (!source.ast.is.IsFunctionTypeNode(node)) {
    return [];
  }
  const returnType = source.ast.typeNode(node);
  return returnType === undefined ? [] : [returnType];
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
        exactAwaitableContract(semantics, returnType, innerType, new Set())
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
        exactAwaitableContract(semantics, type, innerType, new Set())
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
  pending: Set<Type>,
): boolean {
  if (sameSelectedType(semantics, type, innerType)) {
    return true;
  }
  if (pending.has(type)) {
    return false;
  }
  if (semantics.isUnion(type)) {
    pending.add(type);
    const exact = semantics.getUnionOrIntersectionTypes(type).every((member) =>
      member !== undefined &&
      exactAwaitableContract(semantics, member, innerType, pending)
    );
    pending.delete(type);
    return exact;
  }
  if (!typeMaySuspend(semantics, type) || !semantics.isTypeReference(type)) {
    return false;
  }
  const arguments_ = semantics.getTypeArguments(type);
  return arguments_.length === 1 &&
    sameSelectedType(semantics, arguments_[0], innerType);
}

function callableTypeAllowsSynchronousValue(
  semantics: SourceFileSemantics,
  type: Type,
  pending: Set<Type>,
): boolean {
  if (
    pending.has(type) ||
    semantics.isAny(type) ||
    semantics.isUnknown(type)
  ) {
    return false;
  }
  if (semantics.isNullish(type)) {
    return true;
  }
  if (semantics.isUnion(type)) {
    pending.add(type);
    let callable = false;
    for (const member of semantics.getUnionOrIntersectionTypes(type)) {
      if (member === undefined || semantics.isNullish(member)) {
        continue;
      }
      if (!callableTypeAllowsSynchronousValue(semantics, member, pending)) {
        pending.delete(type);
        return false;
      }
      callable = true;
    }
    pending.delete(type);
    return callable;
  }
  const signatures = semantics.getCallSignatures(type);
  return signatures.length !== 0 && signatures.every((signature) => {
    const returnType = semantics.getReturnTypeOfSignature(signature);
    return returnType !== undefined && returnTypeAllowsSynchronousValue(
      semantics,
      returnType,
    );
  });
}

function returnTypeAllowsSynchronousValue(
  semantics: SourceFileSemantics,
  type: Type,
): boolean {
  if (!semantics.isUnion(type)) {
    return !typeMaySuspend(semantics, type);
  }
  return semantics.getUnionOrIntersectionTypes(type).some((member) =>
    member !== undefined && !typeMaySuspend(semantics, member)
  );
}
