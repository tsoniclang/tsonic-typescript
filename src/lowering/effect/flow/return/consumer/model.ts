import type { Node } from "@tsonic/tsts";
import type { TargetSourceProgram } from "@tsonic/target-api/source";

import type { TargetProgramIndex } from "../../../../program-index.js";
import type { EffectProvenanceGraphBuilder } from "../../../provenance/graph.js";
import type {
  EffectProvenanceVertex,
} from "../../../provenance/model.js";
import type { ExactAggregateProjectionIndex } from "../../aggregate/projection.js";
import type { ExactInvocationInputIndex } from "../../invocation/inputs.js";
import type { ExactObjectPropertyProjectionIndex } from "../../object/projection.js";
import type { ExactCallableBodyInspection } from "../../callable/result-inputs.js";

export type ResultConsumerBoundary =
  | "open-binding"
  | "open-consumer"
  | "open-forwarder"
  | "open-reference"
  | "open-storage";

export interface ConsumerState {
  readonly vertex: EffectProvenanceVertex;
  readonly kind: "value" | "binding" | "result";
  readonly occurrence: Node;
  expanded: boolean;
}

export interface ConsumerContext {
  readonly source: TargetSourceProgram;
  readonly program: TargetProgramIndex;
  readonly candidates: ReadonlySet<Node>;
  readonly callableReferenceIsClosed: ((reference: Node) => boolean) | undefined;
  readonly bodyInspectionIsCertified: ExactCallableBodyInspection | undefined;
  readonly allowExportedDeclarations: boolean;
  readonly invocationInputs: ExactInvocationInputIndex;
  readonly projections: ExactAggregateProjectionIndex;
  readonly objectProjections: ExactObjectPropertyProjectionIndex;
  readonly closedStorageOwners: ReadonlySet<Node>;
  readonly callsByDeclaration: ReadonlyMap<Node, readonly Node[]>;
  readonly projectionOrigins: ReadonlyMap<Node, readonly Node[]>;
  readonly projectionInvocations: ReadonlyMap<Node, readonly Node[]>;
  readonly projectionReads: ReadonlySet<Node>;
  readonly builder: EffectProvenanceGraphBuilder<ResultConsumerBoundary>;
  readonly values: Map<Node, ConsumerState>;
  readonly bindings: Map<Node, ConsumerState>;
  readonly results: Map<Node, ConsumerState>;
  readonly pending: ConsumerState[];
  consumerEdges: number;
}

export interface ResultConsumerGraph {
  readonly ownerEvaluations: number;
  readonly consumerEdges: number;
  callHasClosedConsumers(call: Node): boolean;
}
