import type { Node, Type } from "@tsonic/tsts";
import type { TargetSourceProgram } from "@tsonic/target-api";

export function pointerTypeCanBeUndefined(
  source: TargetSourceProgram,
  anchor: Node,
  type: Type,
): boolean {
  const semantics = source.semantics.forNode(anchor);
  if (semantics.isNullish(type) || semantics.isAny(type) || semantics.isUnknown(type)) {
    return true;
  }
  if (semantics.isUnion(type)) {
    return semantics.getUnionOrIntersectionTypes(type).some((member) =>
      member === undefined || pointerTypeCanBeUndefined(source, anchor, member)
    );
  }
  if (semantics.isIntersection(type)) {
    return semantics.getUnionOrIntersectionTypes(type).every((member) =>
      member === undefined || pointerTypeCanBeUndefined(source, anchor, member)
    );
  }
  return semantics.couldContainTypeVariables(type) &&
    !semantics.isTypeReference(type);
}
