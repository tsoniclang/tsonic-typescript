import type { Node } from "@tsonic/tsts";

import type { EffectProvenanceEdgeKind } from "../../../provenance/model.js";
import type {
  ConsumerContext,
  ConsumerState,
  ResultConsumerBoundary,
} from "./model.js";

export function addConsumerDependency(
  destination: ConsumerState,
  source: ConsumerState,
  kind: EffectProvenanceEdgeKind,
  occurrence: Node,
  context: ConsumerContext,
): void {
  context.builder.addDependency(destination.vertex, source.vertex, kind, occurrence);
  context.consumerEdges += 1;
}

export function addConsumerOrigin(
  state: ConsumerState,
  occurrence: Node,
  context: ConsumerContext,
): void {
  context.builder.addOrigin(state.vertex, occurrence);
}

export function addConsumerBoundary(
  state: ConsumerState,
  reason: ResultConsumerBoundary,
  occurrence: Node,
  context: ConsumerContext,
): void {
  context.builder.addBoundary(state.vertex, reason, occurrence);
}
