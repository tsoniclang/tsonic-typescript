import type { Node, Type } from "@tsonic/tsts";
import type { TargetSourceProgram } from "@tsonic/target-api";

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
    semantics.isAny(pointee) ||
    semantics.isUnknown(pointee) ||
    semantics.isNever(pointee) ||
    semantics.isVoidLike(pointee) ||
    semantics.isNullish(pointee) ||
    semantics.isUnion(pointee) ||
    semantics.isIntersection(pointee) ||
    semantics.couldContainTypeVariables(pointee)
  ) {
    return undefined;
  }
  for (const [identity, matches] of [
    ["string", semantics.isStringLike(pointee)],
    ["number", semantics.isNumberLike(pointee)],
    ["boolean", semantics.isBooleanLike(pointee)],
    ["bigint", semantics.isBigIntLike(pointee)],
  ] as const) {
    if (matches) {
      return Object.freeze({ category: "scalar", identity });
    }
  }
  const symbol = semantics.getTypeSymbol(pointee);
  const declaration = semantics.getPrimarySymbolDeclaration(symbol);
  return declaration !== undefined &&
    source.navigation.isProjectDeclaration(declaration) &&
    source.ast.is.IsClassDeclaration(declaration)
    ? Object.freeze({ category: "direct-reference", identity: declaration })
    : undefined;
}
