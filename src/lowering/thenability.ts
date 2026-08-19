import type {
  Type,
  TypePropertyInfo,
} from "@tsonic/tsts";
import type {
  SourceFileSemantics,
  TargetSourceProgram,
} from "@tsonic/target-api";

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
    semantics.isAny(type) ||
    semantics.isUnknown(type)
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
