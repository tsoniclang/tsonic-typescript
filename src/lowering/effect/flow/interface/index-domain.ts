import type { Type, TypeIndexInfo, TypePropertyInfo } from "@tsonic/tsts";
import type {
  SourceFileSemantics,
  TargetSourceProgram,
} from "@tsonic/target-api/source";

export function indexDomainCovers(
  semantics: SourceFileSemantics,
  source: Type,
  target: Type,
): boolean {
  if (semantics.types.isStringLike(target)) {
    return semantics.types.isStringLike(source);
  }
  if (semantics.types.isNumberLike(target)) {
    return semantics.types.isStringLike(source) || semantics.types.isNumberLike(source);
  }
  return semantics.types.isIdentical(source, target);
}

export function indexCoversProperty(
  source: TargetSourceProgram,
  semantics: SourceFileSemantics,
  index: TypeIndexInfo,
  property: TypePropertyInfo,
): boolean {
  if (index.keyType === undefined) {
    return false;
  }
  if (semantics.types.isStringLike(index.keyType)) {
    return true;
  }
  return semantics.types.isNumberLike(index.keyType) &&
    propertyHasNumericDeclaration(source, semantics, property);
}

function propertyHasNumericDeclaration(
  source: TargetSourceProgram,
  semantics: SourceFileSemantics,
  property: TypePropertyInfo,
): boolean {
  return property.rootSymbols.some((symbol) =>
    semantics.declarations.symbolDeclarations(symbol).some((declaration) => {
      const name = source.ast.name(declaration);
      return name !== undefined && source.ast.is.IsNumericLiteral(name);
    })
  );
}
