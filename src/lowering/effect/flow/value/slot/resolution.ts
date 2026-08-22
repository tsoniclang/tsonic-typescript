import type { Node } from "@tsonic/tsts";

import { createEffectProvenanceOriginIndex } from "../../../provenance/origin-index.js";
import type {
  EffectProvenanceGraph,
  EffectProvenanceResolutionIndex,
  EffectProvenanceVertex,
} from "../../../provenance/model.js";
import type {
  ExactValueSlotResolution,
  ExactValueSlotStep,
} from "./model.js";

const openValueSlotResolution: ExactValueSlotResolution = Object.freeze({
  closed: false,
  expressions: Object.freeze([]),
  steps: Object.freeze([]),
});

export function materializeExactValueSlotResolutions<Reason extends string>(
  graph: EffectProvenanceGraph<Reason>,
  resolutions: EffectProvenanceResolutionIndex<Reason>,
  roots: ReadonlyMap<Node, EffectProvenanceVertex>,
  valueOrigins: ReadonlyMap<number, ReadonlySet<Node>>,
  stepsByVertex: ReadonlyMap<number, ExactValueSlotStep>,
): ReadonlyMap<Node, ExactValueSlotResolution> {
  const origins = createEffectProvenanceOriginIndex(
    graph,
    resolutions,
    [(origin) =>
      valueOrigins.has(origin.vertex.index) ||
        stepsByVertex.has(origin.vertex.index)
        ? origin.vertex
        : undefined],
  );
  const result = new Map<Node, ExactValueSlotResolution>();
  for (const [expression, vertex] of roots) {
    if (!resolutions.resolutionFor(vertex).closed) {
      result.set(expression, openValueSlotResolution);
      continue;
    }
    const values = new Set<Node>();
    const steps = new Map<number, ExactValueSlotStep>();
    for (const origin of origins.selectionFor(vertex, 0).values()) {
      for (const value of valueOrigins.get(origin.index) ?? []) {
        values.add(value);
      }
      const step = stepsByVertex.get(origin.index);
      if (step !== undefined) {
        steps.set(origin.index, step);
      }
    }
    result.set(expression, Object.freeze({
      closed: true,
      expressions: Object.freeze([...values]),
      steps: Object.freeze([...steps.values()]),
    }));
  }
  return result;
}
