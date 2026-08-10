import type { Node, Type } from "@tsonic/tsts";
import type {
  SourceFileSemantics,
  TargetSourceProgram,
} from "@tsonic/target-api";

export function resolvedCallIsDefinitelySynchronous(
  source: TargetSourceProgram,
  call: Node,
): boolean {
  const semantics = source.semantics.forNode(call);
  const signature = semantics.getResolvedSignature(call);
  const declaration = semantics.getSignatureDeclaration(signature);
  const returnType = semantics.getReturnTypeOfSignature(signature);
  return declaration !== undefined &&
    !source.ast.hasModifierKind(declaration, "async") &&
    returnType !== undefined &&
    !typeMaySuspend(semantics, returnType, new Set());
}

export function callableIsDefinitelySynchronous(
  source: TargetSourceProgram,
  declaration: Node,
): boolean {
  if (
    !isCallableDeclaration(source, declaration) ||
    source.ast.body(declaration) === undefined ||
    source.ast.hasModifierKind(declaration, "async")
  ) {
    return false;
  }
  const semantics = source.semantics.forNode(declaration);
  const type = semantics.getTypeAtLocation(
    source.ast.name(declaration) ?? declaration,
  );
  if (type === undefined) {
    return false;
  }
  const signatures = semantics.getCallSignatures(type);
  return signatures.length !== 0 && signatures.every((signature) => {
    const returnType = semantics.getReturnTypeOfSignature(signature);
    return returnType !== undefined &&
      !typeMaySuspend(semantics, returnType, new Set());
  });
}

function typeMaySuspend(
  semantics: SourceFileSemantics,
  type: Type,
  pending: Set<Type>,
): boolean {
  if (pending.has(type)) {
    return true;
  }
  if (
    semantics.isAny(type) ||
    semantics.isUnknown(type) ||
    semantics.couldContainTypeVariables(type)
  ) {
    return true;
  }
  if (
    semantics.isNever(type) ||
    semantics.isVoidLike(type) ||
    semantics.isNullish(type) ||
    semantics.isStringLike(type) ||
    semantics.isNumberLike(type) ||
    semantics.isBooleanLike(type) ||
    semantics.isBigIntLike(type)
  ) {
    return false;
  }
  pending.add(type);
  if (
    semantics.isUnion(type) &&
    semantics.getUnionOrIntersectionTypes(type).some((member) =>
      member === undefined || typeMaySuspend(semantics, member, pending)
    )
  ) {
    pending.delete(type);
    return true;
  }
  const then = semantics.getPropertyInfos(type)
    .find((property) => property.name === "then");
  if (
    then !== undefined &&
    typeCanBeCalled(semantics, then.type, new Set())
  ) {
    pending.delete(type);
    return true;
  }
  const indexedThen = semantics.getIndexInfos(type).some((index) =>
    index.keyType !== undefined &&
    index.valueType !== undefined &&
    semantics.isStringLike(index.keyType) &&
    typeCanBeCalled(semantics, index.valueType, new Set())
  );
  pending.delete(type);
  return indexedThen;
}

function typeCanBeCalled(
  semantics: SourceFileSemantics,
  type: Type,
  pending: Set<Type>,
): boolean {
  if (pending.has(type)) {
    return true;
  }
  if (
    semantics.isAny(type) ||
    semantics.isUnknown(type) ||
    semantics.couldContainTypeVariables(type)
  ) {
    return true;
  }
  if (semantics.getCallSignatures(type).length !== 0) {
    return true;
  }
  if (!semantics.isUnion(type) && !semantics.isIntersection(type)) {
    return false;
  }
  pending.add(type);
  const callable = semantics.getUnionOrIntersectionTypes(type).some((member) =>
    member === undefined || typeCanBeCalled(semantics, member, pending)
  );
  pending.delete(type);
  return callable;
}

function isCallableDeclaration(
  source: TargetSourceProgram,
  node: Node,
): boolean {
  return source.ast.is.IsFunctionDeclaration(node) ||
    source.ast.is.IsFunctionExpression(node) ||
    source.ast.is.IsArrowFunction(node) ||
    source.ast.is.IsMethodDeclaration(node);
}
