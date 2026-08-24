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
import { exactValueSlotPathKey } from "./selectors.js";

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

export function mergeExactValueSlotResolutions(
  target: Map<Node, ExactValueSlotResolution>,
  selected: ReadonlyMap<Node, ExactValueSlotResolution>,
): void {
  for (const [expression, resolution] of selected) {
    const existing = target.get(expression);
    if (existing === undefined) {
      target.set(expression, resolution);
    } else if (!sameResolution(existing, resolution)) {
      throw new Error("value-slot batches produced conflicting exact evidence");
    }
  }
}

function sameResolution(
  left: ExactValueSlotResolution,
  right: ExactValueSlotResolution,
): boolean {
  return left.closed === right.closed && (
    !left.closed ||
    (
      sameNodeSet(left.expressions, right.expressions) &&
      sameStepSet(left.steps, right.steps)
    )
  );
}

function sameNodeSet(left: readonly Node[], right: readonly Node[]): boolean {
  if (left.length !== right.length) {
    return false;
  }
  const selected = new Set(left);
  return right.every((node) => selected.has(node));
}

function sameStepSet(
  left: readonly ExactValueSlotStep[],
  right: readonly ExactValueSlotStep[],
): boolean {
  if (left.length !== right.length) {
    return false;
  }
  const matched = new Uint8Array(right.length);
  for (const step of left) {
    const index = right.findIndex((candidate, candidateIndex) =>
      matched[candidateIndex] === 0 && sameStep(step, candidate)
    );
    if (index < 0) {
      return false;
    }
    matched[index] = 1;
  }
  return true;
}

function sameStep(
  left: ExactValueSlotStep,
  right: ExactValueSlotStep,
): boolean {
  return left.resultOwner === right.resultOwner &&
    left.invocation === right.invocation &&
    exactValueSlotPathKey(left.path) === exactValueSlotPathKey(right.path) &&
    left.contracts.length === right.contracts.length &&
    left.contracts.every((contract, index) =>
      contract === right.contracts[index]
    );
}
