import type { Node, Type } from "@tsonic/tsts";
import type { TargetSourceProgram } from "@tsonic/target-api";

type SourceSemantics = ReturnType<TargetSourceProgram["semantics"]["forNode"]>;

export function storageValueTypeIsClosed(
  semantics: SourceSemantics,
  type: Type,
  owners: ReadonlySet<Node>,
  pending: Set<Type>,
): boolean {
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
  if (semantics.isAny(type) || semantics.isUnknown(type)) {
    return false;
  }
  if (directStorageOwners(semantics, type, owners).size !== 0) {
    return true;
  }
  if (!semantics.isUnion(type) || pending.has(type)) {
    return false;
  }
  pending.add(type);
  const result = semantics.getUnionOrIntersectionTypes(type).every((member) =>
    member !== undefined && storageValueTypeIsClosed(
      semantics,
      member,
      owners,
      pending,
    )
  );
  pending.delete(type);
  return result;
}

export function ownersWithinStorageType(
  source: TargetSourceProgram,
  semantics: SourceSemantics,
  type: Type,
  candidates: ReadonlySet<Node>,
  cache: Map<Type, ReadonlySet<Node>>,
  pending: Set<Type>,
): ReadonlySet<Node> {
  const existing = cache.get(type);
  if (existing !== undefined) {
    return existing;
  }
  if (pending.has(type)) {
    return new Set();
  }
  if (storageTypeCannotCarryOwner(semantics, type)) {
    const empty = new Set<Node>();
    cache.set(type, empty);
    return empty;
  }
  pending.add(type);
  const result = directStorageOwners(semantics, type, candidates);
  for (const member of nestedStorageTypes(source, semantics, type)) {
    for (const owner of ownersWithinStorageType(
      source,
      semantics,
      member,
      candidates,
      cache,
      pending,
    )) {
      result.add(owner);
    }
  }
  pending.delete(type);
  cache.set(type, result);
  return result;
}

export function directStorageOwners(
  semantics: SourceSemantics,
  type: Type,
  candidates: ReadonlySet<Node>,
): Set<Node> {
  const result = new Set<Node>();
  const declaration = semantics.getPrimarySymbolDeclaration(
    semantics.getTypeSymbol(type),
  );
  if (declaration !== undefined && candidates.has(declaration)) {
    result.add(declaration);
  }
  const target = semantics.isTypeReference(type)
    ? semantics.getTypeReferenceTarget(type)
    : undefined;
  const targetDeclaration = target === undefined
    ? undefined
    : semantics.getPrimarySymbolDeclaration(semantics.getTypeSymbol(target));
  if (targetDeclaration !== undefined && candidates.has(targetDeclaration)) {
    result.add(targetDeclaration);
  }
  return result;
}

function nestedStorageTypes(
  source: TargetSourceProgram,
  semantics: SourceSemantics,
  type: Type,
): readonly Type[] {
  const nested = [
    ...(semantics.isUnion(type) || semantics.isIntersection(type)
      ? semantics.getUnionOrIntersectionTypes(type)
      : []),
    ...(semantics.isTypeReference(type) ? semantics.getTypeArguments(type) : []),
  ].filter((member): member is Type => member !== undefined);
  const declaration = semantics.getPrimarySymbolDeclaration(
    semantics.getTypeSymbol(type),
  );
  if (
    declaration === undefined ||
    !source.navigation.isProjectDeclaration(declaration) ||
    !source.ast.is.IsClassDeclaration(declaration)
  ) {
    return nested;
  }
  for (const property of semantics.getPropertyInfos(type)) {
    const propertyDeclaration = semantics.getPrimarySymbolDeclaration(
      property.symbol,
    );
    if (
      propertyDeclaration !== undefined &&
      source.navigation.isProjectDeclaration(propertyDeclaration) &&
      storageMemberCanCarryValue(source, propertyDeclaration)
    ) {
      nested.push(property.type);
    }
  }
  return nested;
}

function storageMemberCanCarryValue(
  source: TargetSourceProgram,
  declaration: Node,
): boolean {
  if (source.ast.hasModifierKind(declaration, "static")) {
    return false;
  }
  if (source.ast.is.IsPropertyDeclaration(declaration)) {
    return true;
  }
  if (!source.ast.is.IsParameterDeclaration(declaration)) {
    return false;
  }
  const constructor = source.ast.parent(declaration);
  return constructor !== undefined &&
    source.ast.is.IsConstructorDeclaration(constructor) &&
    (["public", "private", "protected", "readonly"] as const).some(
      (modifier) => source.ast.hasModifierKind(declaration, modifier),
    );
}

function storageTypeCannotCarryOwner(
  semantics: SourceSemantics,
  type: Type,
): boolean {
  return semantics.isAny(type) ||
    semantics.isUnknown(type) ||
    semantics.isNever(type) ||
    semantics.isVoidLike(type) ||
    semantics.isNullish(type) ||
    semantics.isStringLike(type) ||
    semantics.isNumberLike(type) ||
    semantics.isBooleanLike(type) ||
    semantics.isBigIntLike(type);
}
