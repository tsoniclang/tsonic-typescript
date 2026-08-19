import type { Type, TypeIndexInfo, TypePropertyInfo } from "@tsonic/tsts";
import type {
  SourceFileSemantics,
  TargetSourceProgram,
} from "@tsonic/target-api";

export function indexDomainCovers(
  semantics: SourceFileSemantics,
  source: Type,
  target: Type,
): boolean {
  if (semantics.isStringLike(target)) {
    return semantics.isStringLike(source);
  }
  if (semantics.isNumberLike(target)) {
    return semantics.isStringLike(source) || semantics.isNumberLike(source);
  }
  return semantics.isTypeIdenticalTo(source, target);
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
  if (semantics.isStringLike(index.keyType)) {
    return true;
  }
  return semantics.isNumberLike(index.keyType) &&
    propertyHasNumericDeclaration(source, semantics, property);
}

function propertyHasNumericDeclaration(
  source: TargetSourceProgram,
  semantics: SourceFileSemantics,
  property: TypePropertyInfo,
): boolean {
  return property.rootSymbols.some((symbol) =>
    semantics.getSymbolDeclarations(symbol).some((declaration) => {
      const name = source.ast.name(declaration);
      return name !== undefined && source.ast.is.IsNumericLiteral(name);
    })
  );
}
