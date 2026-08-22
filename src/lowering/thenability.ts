import type {
  Type,
  TypePropertyInfo,
} from "@tsonic/tsts";
import type {
  SourceFileSemantics,
  TargetSourceProgram,
} from "@tsonic/target-api/source";

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

function typeHasDefinitelyNonThenableContractWithin(
  source: TargetSourceProgram,
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
  if (
    semantics.types.isNever(type) ||
    semantics.types.isVoidLike(type) ||
    semantics.types.isNullish(type) ||
    semantics.types.isStringLike(type) ||
    semantics.types.isNumberLike(type) ||
    semantics.types.isBooleanLike(type) ||
    semantics.types.isBigIntLike(type)
  ) {
    return true;
  }
  if (semantics.types.isUnion(type)) {
    pending.add(type);
    const closed = semantics.types.unionOrIntersectionTypes(type).every((member) =>
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
  const then = semantics.types.propertyInfos(type)
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
  const declarations = semantics.declarations.symbolDeclarations(property.symbol);
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
    semantics.types.isAny(type) ||
    semantics.types.isUnknown(type) ||
    semantics.types.couldContainTypeVariables(type)
  ) {
    return false;
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
    return true;
  }
  if (!semantics.types.isUnion(type)) {
    return false;
  }
  pending.add(type);
  const excluded = semantics.types.unionOrIntersectionTypes(type).every((member) =>
    member !== undefined &&
    typeCannotBeCallable(semantics, member, pending)
  );
  pending.delete(type);
  return excluded;
}
