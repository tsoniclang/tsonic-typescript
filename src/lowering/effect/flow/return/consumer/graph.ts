import type { Node } from "@tsonic/tsts";
import type { TargetSourceProgram } from "@tsonic/target-api/source";

import type { InvocationTransportContract } from "../../../../invocation-transport.js";
import type { TargetProgramIndex } from "../../../../program-index.js";
import type { TypeScriptActiveCooperativeEffectProfile } from "../../../../profile.js";
import { createEffectProvenanceGraphBuilder } from "../../../provenance/graph.js";
import { resolveEffectProvenance } from "../../../provenance/resolution.js";
import type { ExactAggregateProjectionIndex } from "../../aggregate/projection.js";
import type { ExactCallableBodyInspection } from "../../callable/result-inputs.js";
import type { ExactInvocationInputIndex } from "../../invocation/inputs.js";
import type { ExactObjectPropertyProjectionIndex } from "../../object/projection.js";
import type { ClosedStorageOwnerAnalysis } from "../../storage/analysis.js";
import {
  createConsumerValueState,
  expandConsumerState,
} from "./expansion.js";
import {
  indexResultConsumerCalls,
  indexResultProjectionReads,
} from "./facts.js";
import type {
  ConsumerContext,
  ResultConsumerBoundary,
  ResultConsumerGraph,
} from "./model.js";

export type { ResultConsumerGraph } from "./model.js";

export function createResultConsumerGraph(
  source: TargetSourceProgram,
  program: TargetProgramIndex,
  queries: ReadonlySet<Node>,
  candidates: ReadonlySet<Node>,
  invocationInputs: ExactInvocationInputIndex,
  projections: ExactAggregateProjectionIndex,
  objectProjections: ExactObjectPropertyProjectionIndex,
  storageOwners: ClosedStorageOwnerAnalysis,
  exactCallImplementations?: (call: Node) => readonly Node[] | undefined,
  transports?: InvocationTransportContract,
  callableReferenceIsClosed?: (reference: Node) => boolean,
  bodyInspectionIsCertified?: ExactCallableBodyInspection,
  cooperativeEffects: TypeScriptActiveCooperativeEffectProfile = "closed-direct",
): ResultConsumerGraph {
  const projectionReads = indexResultProjectionReads(
    source,
    program,
    projections,
    invocationInputs,
    exactCallImplementations,
    transports,
    storageOwners,
    bodyInspectionIsCertified,
    cooperativeEffects,
  );
  const allowExportedDeclarations = cooperativeEffects === "closed-program";
  const context: ConsumerContext = {
    source,
    program,
    candidates,
    callableReferenceIsClosed,
    bodyInspectionIsCertified,
    allowExportedDeclarations,
    invocationInputs,
    projections,
    objectProjections,
    closedStorageOwners: storageOwners.owners,
    callsByDeclaration: indexResultConsumerCalls(
      source,
      program,
      exactCallImplementations,
      bodyInspectionIsCertified,
    ),
    projectionOrigins: projectionReads.origins,
    projectionInvocations: projectionReads.invocations,
    projectionReads: projectionReads.reads,
    builder: createEffectProvenanceGraphBuilder<ResultConsumerBoundary>(),
    values: new Map(),
    bindings: new Map(),
    results: new Map(),
    pending: [],
    consumerEdges: 0,
  };
  for (const call of queries) {
    if (!source.ast.is.IsCallExpression(call)) {
      throw new Error("result-consumer query is not a call expression");
    }
    createConsumerValueState(call, context);
  }
  while (context.pending.length !== 0) {
    const state = context.pending.pop();
    if (state === undefined || state.expanded) {
      continue;
    }
    state.expanded = true;
    expandConsumerState(state, context);
  }
  const resolution = resolveEffectProvenance(context.builder.seal());
  const closedCalls = new Set<Node>();
  for (const call of queries) {
    const state = context.values.get(call);
    if (state === undefined) {
      throw new Error("result-consumer query has no provenance state");
    }
    if (resolution.resolutionFor(state.vertex).closed) {
      closedCalls.add(call);
    }
  }
  const ownerEvaluations = context.results.size;
  const consumerEdges = context.consumerEdges;
  return Object.freeze({
    ownerEvaluations,
    consumerEdges,
    callHasClosedConsumers(call: Node): boolean {
      return closedCalls.has(call);
    },
  });
}
