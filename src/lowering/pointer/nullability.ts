import type { Node, Type } from "@tsonic/tsts";
import type { TargetSourceProgram } from "@tsonic/target-api/source";

export function pointerTypeCanBeUndefined(
  source: TargetSourceProgram,
  anchor: Node,
  type: Type,
): boolean {
  const semantics = source.semantics.forNode(anchor);
  if (semantics.types.isNullish(type) || semantics.types.isAny(type) || semantics.types.isUnknown(type)) {
    return true;
  }
  if (semantics.types.isUnion(type)) {
    return semantics.types.unionOrIntersectionTypes(type).some((member) =>
      member === undefined || pointerTypeCanBeUndefined(source, anchor, member)
    );
  }
  if (semantics.types.isIntersection(type)) {
    return semantics.types.unionOrIntersectionTypes(type).every((member) =>
      member === undefined || pointerTypeCanBeUndefined(source, anchor, member)
    );
  }
  return semantics.types.couldContainTypeVariables(type) &&
    !semantics.types.isTypeReference(type);
}
