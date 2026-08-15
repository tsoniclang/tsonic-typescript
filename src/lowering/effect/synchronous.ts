import type {
  Node,
  Signature,
  Type,
  TypePropertyInfo,
} from "@tsonic/tsts";
import type {
  SourceFileSemantics,
  TargetSourceProgram,
} from "@tsonic/target-api";

export function resolvedCallUsesSynchronousTransport(
  source: TargetSourceProgram,
  call: Node,
): boolean {
  const semantics = source.semantics.forNode(call);
  const signature = semantics.getResolvedSignature(call);
  const declaration = semantics.getSignatureDeclaration(signature);
  return declarationUsesSynchronousBody(source, declaration) ||
    (declarationHasTrustedContract(source, declaration) &&
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
  const signature = semantics.getResolvedSignature(call);
  return declarationHasTrustedContract(
    source,
    semantics.getSignatureDeclaration(signature),
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
  const type = semantics.getTypeAtLocation(selected);
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
  const signatures = semantics.getCallSignatures(type);
  return signatures.length !== 0 && signatures.every((signature) =>
    declarationHasTrustedContract(
      source,
      semantics.getSignatureDeclaration(signature),
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
  const type = semantics.getTypeFromTypeNode(typeNode);
  return type !== undefined && !typeMaySuspend(semantics, type);
}

export function typeHasDefinitelyNonThenableContract(
  source: TargetSourceProgram,
  semantics: SourceFileSemantics,
  type: Type,
): boolean {
  return typeHasDefinitelyNonThenableContractWithin(
    source,
    semantics,
    type,
    new Set(),
  );
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
      member === undefined || typeMaySuspendWithin(semantics, member, pending)
    )
  ) {
    pending.delete(type);
    return true;
  }
  const then = semantics.getPropertyInfos(type)
    .find((property) => property.name === "then");
  if (
    then !== undefined &&
    typeMayBeCallable(semantics, then.type)
  ) {
    pending.delete(type);
    return true;
  }
  const indexedThen = semantics.getIndexInfos(type).some((index) =>
    index.keyType !== undefined &&
    index.valueType !== undefined &&
    semantics.isStringLike(index.keyType) &&
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
  if (left === undefined || right === undefined) {
    return false;
  }
  if (left === right) {
    return true;
  }
  if (
    (semantics.isNumberLike(left) && semantics.isNumberLike(right)) ||
    (semantics.isStringLike(left) && semantics.isStringLike(right)) ||
    (semantics.isBooleanLike(left) && semantics.isBooleanLike(right)) ||
    (semantics.isBigIntLike(left) && semantics.isBigIntLike(right)) ||
    (semantics.isVoidLike(left) && semantics.isVoidLike(right))
  ) {
    return true;
  }
  if (
    !semantics.isTypeReference(left) ||
    !semantics.isTypeReference(right) ||
    semantics.getTypeReferenceTarget(left) !==
      semantics.getTypeReferenceTarget(right)
  ) {
    return false;
  }
  const leftArguments = semantics.getTypeArguments(left);
  const rightArguments = semantics.getTypeArguments(right);
  return leftArguments.length === rightArguments.length &&
    leftArguments.every((argument, index) =>
      sameSelectedType(semantics, argument, rightArguments[index])
    );
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

function typeExposesCallableThenWithin(
  semantics: SourceFileSemantics,
  type: Type,
  pending: Set<Type>,
): boolean {
  if (pending.has(type)) {
    return true;
  }
  if (semantics.isAny(type) || semantics.isUnknown(type)) {
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
    (semantics.isUnion(type) || semantics.isIntersection(type)) &&
    semantics.getUnionOrIntersectionTypes(type).some((member) =>
      member === undefined ||
      typeExposesCallableThenWithin(semantics, member, pending)
    )
  ) {
    pending.delete(type);
    return true;
  }
  const then = semantics.getPropertyInfos(type)
    .find((property) => property.name === "then");
  const result =
    (then !== undefined && typeMayBeCallable(semantics, then.type)) ||
    semantics.getIndexInfos(type).some((index) =>
      index.keyType !== undefined &&
      index.valueType !== undefined &&
      semantics.isStringLike(index.keyType) &&
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
  const result = semantics.getReturnTypeOfSignature(signature);
  return result !== undefined &&
    typeHasDefinitelyNonThenableContract(source, semantics, result);
}

function typeHasDefinitelyNonThenableContractWithin(
  source: TargetSourceProgram,
  semantics: SourceFileSemantics,
  type: Type,
  pending: Set<Type>,
): boolean {
  if (
    pending.has(type) ||
    semantics.isAny(type) ||
    semantics.isUnknown(type) ||
    semantics.couldContainTypeVariables(type)
  ) {
    return false;
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
    return true;
  }
  if (semantics.isUnion(type)) {
    pending.add(type);
    const closed = semantics.getUnionOrIntersectionTypes(type).every((member) =>
      member !== undefined &&
      typeHasDefinitelyNonThenableContractWithin(
        source,
        semantics,
        member,
        pending,
      )
    );
    pending.delete(type);
    return closed;
  }
  const then = semantics.getPropertyInfos(type)
    .find((property) => property.name === "then");
  if (then === undefined) {
    return false;
  }

  return propertyIsNominalThenExclusion(source, semantics, then) &&
    typeCannotBeCallable(semantics, then.type, new Set());
}

function propertyIsNominalThenExclusion(
  source: TargetSourceProgram,
  semantics: SourceFileSemantics,
  property: TypePropertyInfo,
): boolean {
  if (!property.optional || !property.readonly) {
    return false;
  }
  const declarations = semantics.getSymbolDeclarations(property.symbol);
  return declarations.length !== 0 && declarations.every((declaration) =>
    source.ast.hasModifierKind(declaration, "private")
  );
}

function typeCannotBeCallable(
  semantics: SourceFileSemantics,
  type: Type,
  pending: Set<Type>,
): boolean {
  if (
    pending.has(type) ||
    semantics.isAny(type) ||
    semantics.isUnknown(type) ||
    semantics.couldContainTypeVariables(type)
  ) {
    return false;
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
    return true;
  }
  if (!semantics.isUnion(type)) {
    return false;
  }
  pending.add(type);
  const excluded = semantics.getUnionOrIntersectionTypes(type).every((member) =>
    member !== undefined &&
    typeCannotBeCallable(semantics, member, pending)
  );
  pending.delete(type);
  return excluded;
}
