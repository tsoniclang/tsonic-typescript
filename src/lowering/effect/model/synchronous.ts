import type {
  Node,
  Signature,
  Type,
} from "@tsonic/tsts";
import type {
  SourceFileSemantics,
  TargetSourceProgram,
} from "@tsonic/target-api/source";

import { typeHasDefinitelyNonThenableContract } from "../../thenability.js";
import { resolveProjectInvocation } from "./project-invocation.js";

export function resolvedCallUsesSynchronousTransport(
  source: TargetSourceProgram,
  call: Node,
): boolean {
  const semantics = source.semantics.forNode(call);
  const signature = semantics.operations.call(call)?.selectedSignature;
  const contract = signature === undefined
    ? undefined
    : semantics.declarations.signatureDeclaration(signature);
  const implementation = resolveProjectInvocation(source, call)
    ?.implementation;
  return declarationUsesSynchronousBody(source, implementation) ||
    (declarationHasTrustedContract(source, contract) &&
      resolvedSignatureResultIsDefinitelyNonThenable(
        source,
        semantics,
        signature,
      ));
}

export function resolvedCallResultIsDefinitelyNonThenable(
  source: TargetSourceProgram,
  call: Node,
): boolean {
  const semantics = source.semantics.forNode(call);
  const signature = semantics.operations.call(call)?.selectedSignature;
  return declarationHasTrustedContract(
    source,
    signature === undefined
      ? undefined
      : semantics.declarations.signatureDeclaration(signature),
  ) && resolvedSignatureResultIsDefinitelyNonThenable(
    source,
    semantics,
    signature,
  );
}

export function callableContractResultIsDefinitelyNonThenable(
  source: TargetSourceProgram,
  declaration: Node,
): boolean {
  if (!declarationHasTrustedContract(source, declaration)) {
    return false;
  }
  const selected = source.ast.name(declaration) ?? declaration;
  const semantics = source.semantics.forNode(selected);
  const type = semantics.types.expressionType(selected);
  if (type === undefined) {
    return false;
  }
  return typeHasTrustedSynchronousCallSignatures(source, semantics, type);
}

export function typeHasTrustedSynchronousCallSignatures(
  source: TargetSourceProgram,
  semantics: SourceFileSemantics,
  type: Type,
): boolean {
  const signatures = semantics.types.callSignatures(type);
  return signatures.length !== 0 && signatures.every((signature) =>
    declarationHasTrustedContract(
      source,
      semantics.declarations.signatureDeclaration(signature),
    ) && resolvedSignatureResultIsDefinitelyNonThenable(
        source,
        semantics,
        signature,
      )
  );
}

export function callableUsesSynchronousTransport(
  source: TargetSourceProgram,
  declaration: Node,
): boolean {
  if (declarationUsesSynchronousBody(source, declaration)) {
    return true;
  }
  if (source.ast.hasModifierKind(declaration, "async")) {
    return false;
  }
  return callableContractResultIsDefinitelyNonThenable(
    source,
    declaration,
  );
}

export function callableBodyResultIsDefinitelyNonThenable(
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
  const typeNode = source.ast.typeNode(declaration);
  if (typeNode === undefined) {
    return false;
  }
  const semantics = source.semantics.forNode(typeNode);
  const type = semantics.types.authoredType(typeNode);
  return type !== undefined && !typeMaySuspend(semantics, type);
}

export function typeMaySuspend(
  semantics: SourceFileSemantics,
  type: Type,
): boolean {
  return typeMaySuspendWithin(semantics, type, new Set());
}

export function typeExposesCallableThen(
  semantics: SourceFileSemantics,
  type: Type,
): boolean {
  return typeExposesCallableThenWithin(semantics, type, new Set());
}

function typeMaySuspendWithin(
  semantics: SourceFileSemantics,
  type: Type,
  pending: Set<Type>,
): boolean {
  if (pending.has(type)) {
    return true;
  }
  if (
    semantics.types.isAny(type) ||
    semantics.types.isUnknown(type) ||
    semantics.types.couldContainTypeVariables(type)
  ) {
    return true;
  }
  if (
    semantics.types.isNever(type) ||
    semantics.types.isVoidLike(type) ||
    semantics.types.isNullish(type) ||
    semantics.types.isStringLike(type) ||
    semantics.types.isNumberLike(type) ||
    semantics.types.isBooleanLike(type) ||
    semantics.types.isBigIntLike(type)
  ) {
    return false;
  }
  pending.add(type);
  if (
    semantics.types.isUnion(type) &&
    semantics.types.unionOrIntersectionTypes(type).some((member) =>
      member === undefined || typeMaySuspendWithin(semantics, member, pending)
    )
  ) {
    pending.delete(type);
    return true;
  }
  const then = semantics.types.propertyInfos(type)
    .find((property) => property.name === "then");
  if (
    then !== undefined &&
    typeMayBeCallable(semantics, then.type)
  ) {
    pending.delete(type);
    return true;
  }
  const indexedThen = semantics.types.indexInfos(type).some((index) =>
    index.keyType !== undefined &&
    index.valueType !== undefined &&
    semantics.types.isStringLike(index.keyType) &&
    typeMayBeCallable(semantics, index.valueType)
  );
  pending.delete(type);
  return indexedThen;
}

export function typeMayBeCallable(
  semantics: SourceFileSemantics,
  type: Type,
): boolean {
  return typeCanBeCalled(semantics, type, new Set());
}

export function sameSelectedType(
  semantics: SourceFileSemantics,
  left: Type | undefined,
  right: Type | undefined,
): boolean {
  return sameSelectedTypeWithin(
    semantics,
    left,
    right,
    new Map(),
  );
}

type SelectedTypePairState = "pending" | "same" | "different";

function sameSelectedTypeWithin(
  semantics: SourceFileSemantics,
  left: Type | undefined,
  right: Type | undefined,
  pairs: Map<Type, Map<Type, SelectedTypePairState>>,
): boolean {
  if (left === undefined || right === undefined) {
    return false;
  }
  if (left === right || semantics.types.isIdentical(left, right)) {
    return true;
  }
  const known = pairs.get(left)?.get(right);
  if (known !== undefined) {
    return known !== "different";
  }
  setSelectedTypePairState(pairs, left, right, "pending");
  const same = sameSelectedTypeShape(semantics, left, right, pairs);
  setSelectedTypePairState(
    pairs,
    left,
    right,
    same ? "same" : "different",
  );
  return same;
}

function sameSelectedTypeShape(
  semantics: SourceFileSemantics,
  left: Type,
  right: Type,
  pairs: Map<Type, Map<Type, SelectedTypePairState>>,
): boolean {
  if (
    (semantics.types.isNumberLike(left) && semantics.types.isNumberLike(right)) ||
    (semantics.types.isStringLike(left) && semantics.types.isStringLike(right)) ||
    (semantics.types.isBooleanLike(left) && semantics.types.isBooleanLike(right)) ||
    (semantics.types.isBigIntLike(left) && semantics.types.isBigIntLike(right)) ||
    (semantics.types.isVoidLike(left) && semantics.types.isVoidLike(right))
  ) {
    return true;
  }
  if (semantics.types.isUnion(left) || semantics.types.isUnion(right)) {
    return semantics.types.isUnion(left) && semantics.types.isUnion(right) &&
      sameSelectedTypeMembers(
        semantics,
        semantics.types.unionOrIntersectionTypes(left),
        semantics.types.unionOrIntersectionTypes(right),
        pairs,
      );
  }
  if (semantics.types.isIntersection(left) || semantics.types.isIntersection(right)) {
    return semantics.types.isIntersection(left) && semantics.types.isIntersection(right) &&
      sameSelectedTypeMembers(
        semantics,
        semantics.types.unionOrIntersectionTypes(left),
        semantics.types.unionOrIntersectionTypes(right),
        pairs,
      );
  }
  if (
    !semantics.types.isTypeReference(left) ||
    !semantics.types.isTypeReference(right) ||
    semantics.types.typeReferenceTarget(left) !==
      semantics.types.typeReferenceTarget(right)
  ) {
    return false;
  }
  const leftArguments = semantics.types.typeArguments(left);
  const rightArguments = semantics.types.typeArguments(right);
  return leftArguments.length === rightArguments.length &&
    leftArguments.every((argument, index) =>
      sameSelectedTypeWithin(
        semantics,
        argument,
        rightArguments[index],
        pairs,
      )
    );
}

function sameSelectedTypeMembers(
  semantics: SourceFileSemantics,
  left: readonly (Type | undefined)[],
  right: readonly (Type | undefined)[],
  pairs: Map<Type, Map<Type, SelectedTypePairState>>,
): boolean {
  if (left.length !== right.length || left.some((member) => member === undefined)) {
    return false;
  }
  const unmatched = new Set(right.keys());
  for (const leftMember of left) {
    if (leftMember === undefined) {
      return false;
    }
    const selected = [...unmatched].find((index) =>
      sameSelectedTypeWithin(
        semantics,
        leftMember,
        right[index],
        pairs,
      )
    );
    if (selected === undefined) {
      return false;
    }
    unmatched.delete(selected);
  }
  return true;
}

function setSelectedTypePairState(
  pairs: Map<Type, Map<Type, SelectedTypePairState>>,
  left: Type,
  right: Type,
  state: SelectedTypePairState,
): void {
  const existing = pairs.get(left);
  if (existing === undefined) {
    pairs.set(left, new Map([[right, state]]));
  } else {
    existing.set(right, state);
  }
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
    semantics.types.isAny(type) ||
    semantics.types.isUnknown(type) ||
    semantics.types.couldContainTypeVariables(type)
  ) {
    return true;
  }
  if (semantics.types.callSignatures(type).length !== 0) {
    return true;
  }
  if (!semantics.types.isUnion(type) && !semantics.types.isIntersection(type)) {
    return false;
  }
  pending.add(type);
  const callable = semantics.types.unionOrIntersectionTypes(type).some((member) =>
    member === undefined || typeCanBeCalled(semantics, member, pending)
  );
  pending.delete(type);
  return callable;
}

function typeExposesCallableThenWithin(
  semantics: SourceFileSemantics,
  type: Type,
  pending: Set<Type>,
): boolean {
  if (pending.has(type)) {
    return true;
  }
  if (semantics.types.isAny(type) || semantics.types.isUnknown(type)) {
    return true;
  }
  if (
    semantics.types.isNever(type) ||
    semantics.types.isVoidLike(type) ||
    semantics.types.isNullish(type) ||
    semantics.types.isStringLike(type) ||
    semantics.types.isNumberLike(type) ||
    semantics.types.isBooleanLike(type) ||
    semantics.types.isBigIntLike(type)
  ) {
    return false;
  }
  pending.add(type);
  if (
    (semantics.types.isUnion(type) || semantics.types.isIntersection(type)) &&
    semantics.types.unionOrIntersectionTypes(type).some((member) =>
      member === undefined ||
      typeExposesCallableThenWithin(semantics, member, pending)
    )
  ) {
    pending.delete(type);
    return true;
  }
  const then = semantics.types.propertyInfos(type)
    .find((property) => property.name === "then");
  const result =
    (then !== undefined && typeMayBeCallable(semantics, then.type)) ||
    semantics.types.indexInfos(type).some((index) =>
      index.keyType !== undefined &&
      index.valueType !== undefined &&
      semantics.types.isStringLike(index.keyType) &&
      typeMayBeCallable(semantics, index.valueType)
    );
  pending.delete(type);
  return result;
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

function declarationUsesSynchronousBody(
  source: TargetSourceProgram,
  declaration: Node | undefined,
): boolean {
  return declaration !== undefined &&
    isCallableDeclaration(source, declaration) &&
    source.ast.body(declaration) !== undefined &&
    !source.ast.hasModifierKind(declaration, "async");
}

function declarationHasTrustedContract(
  source: TargetSourceProgram,
  declaration: Node | undefined,
): declaration is Node {
  if (declaration === undefined) {
    return false;
  }
  const sourceFile = source.ast.getSourceFile(declaration);
  return sourceFile !== undefined && source.ast.isDeclarationFile(sourceFile);
}

function resolvedSignatureResultIsDefinitelyNonThenable(
  source: TargetSourceProgram,
  semantics: SourceFileSemantics,
  signature: Signature | undefined,
): boolean {
  const result = signature === undefined
    ? undefined
    : semantics.types.returnType(signature);
  return result !== undefined &&
    typeHasDefinitelyNonThenableContract(source, semantics, result);
}
