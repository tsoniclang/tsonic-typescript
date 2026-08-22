import type { Node } from "@tsonic/tsts";
import type { TargetSourceProgram } from "@tsonic/target-api/source";

import type { ExactAggregateProjectionIndex } from "../../aggregate/projection.js";
import { staticallyNonThenable } from "../provenance/semantics.js";

export function collectReturnProjectionCandidates(
  source: TargetSourceProgram,
  projections: ExactAggregateProjectionIndex,
): readonly Node[] {
  return Object.freeze(
    projections.roots.filter((expression) =>
      !staticallyNonThenable(source, expression)
    ),
  );
}
