import type { Node, Type } from "@tsonic/tsts";
import type { TargetSourceProgram } from "@tsonic/target-api/source";

export type PointerPointeeCategory =
  | "scalar"
  | "direct-reference";

export interface PointerPointeeDescription {
  readonly category: PointerPointeeCategory;
  readonly identity: string | Node;
}

export function describePointerPointee(
  source: TargetSourceProgram,
  anchor: Node,
  pointee: Type,
): PointerPointeeDescription | undefined {
  const semantics = source.semantics.forNode(anchor);
  if (
    semantics.types.isAny(pointee) ||
    semantics.types.isUnknown(pointee) ||
    semantics.types.isNever(pointee) ||
    semantics.types.isVoidLike(pointee) ||
    semantics.types.isNullish(pointee) ||
    semantics.types.isUnion(pointee) ||
    semantics.types.isIntersection(pointee)
  ) {
    return undefined;
  }
  const symbol = semantics.declarations.typeSymbol(pointee);
  const declaration = symbol === undefined
    ? undefined
    : semantics.declarations.primarySymbolDeclaration(symbol);
  if (
    declaration !== undefined &&
    source.navigation.isProjectDeclaration(declaration) &&
    source.ast.is.IsClassDeclaration(declaration)
  ) {
    return Object.freeze({ category: "direct-reference", identity: declaration });
  }
  if (semantics.types.couldContainTypeVariables(pointee)) {
    return undefined;
  }
  for (const [identity, matches] of [
    ["string", semantics.types.isStringLike(pointee)],
    ["number", semantics.types.isNumberLike(pointee)],
    ["boolean", semantics.types.isBooleanLike(pointee)],
    ["bigint", semantics.types.isBigIntLike(pointee)],
  ] as const) {
    if (matches) {
      return Object.freeze({ category: "scalar", identity });
    }
  }
  return undefined;
}
