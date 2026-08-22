import type { Node } from "@tsonic/tsts";

import type { EffectProvenanceOriginIndex } from "../../../provenance/origin-index.js";
import type {
  EffectProvenanceResolutionIndex,
  EffectProvenanceVertex,
} from "../../../provenance/model.js";
import {
  createReturnProvenanceResolution,
  type ReturnProvenanceResolution,
} from "./resolution.js";

export interface ReturnProvenanceFlow {
  resolutionFor(expression: Node): ReturnProvenanceResolution;
  callResolution(call: Node): ReturnProvenanceResolution;
}

export function finalizeReturnProvenanceFlow<Reason extends string>(
  queries: ReadonlyMap<Node, EffectProvenanceVertex>,
  resolutions: EffectProvenanceResolutionIndex<Reason>,
  origins: EffectProvenanceOriginIndex<Node>,
): ReturnProvenanceFlow {
  const resolutionsByComponent = new Map<number, ReturnProvenanceResolution>();
  const resolutionForVertex = (
    vertex: EffectProvenanceVertex,
  ): ReturnProvenanceResolution => {
    const component = resolutions.componentFor(vertex);
    const existing = resolutionsByComponent.get(component);
    if (existing !== undefined) {
      return existing;
    }
    const selected = resolutions.resolutionFor(vertex);
    const dependencies = origins.selectionFor(vertex, 0);
    const result = createReturnProvenanceResolution(
      selected.closed,
      dependencies,
    );
    resolutionsByComponent.set(component, result);
    return result;
  };
  const requireQuery = (expression: Node): EffectProvenanceVertex => {
    const vertex = queries.get(expression);
    if (vertex === undefined) {
      throw new Error("return provenance received an uninventoried expression");
    }
    return vertex;
  };
  return Object.freeze({
    resolutionFor(expression: Node): ReturnProvenanceResolution {
      return resolutionForVertex(requireQuery(expression));
    },
    callResolution(call: Node): ReturnProvenanceResolution {
      return resolutionForVertex(requireQuery(call));
    },
  });
}
