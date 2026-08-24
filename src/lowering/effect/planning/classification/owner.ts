import type { Node } from "@tsonic/tsts";
import type { TargetSourceProgram } from "@tsonic/target-api/source";

import type { CooperativeEffectCandidate } from "../../inventory/candidates.js";
import { isFunctionLike } from "../../model/syntax.js";

export function enclosingCooperativeCandidate(
  source: TargetSourceProgram,
  candidates: ReadonlyMap<Node, CooperativeEffectCandidate>,
  node: Node,
): CooperativeEffectCandidate | undefined {
  let current = source.ast.parent(node);
  while (current !== undefined) {
    if (isFunctionLike(source, current)) {
      return candidates.get(current);
    }
    current = source.ast.parent(current);
  }
  return undefined;
}
