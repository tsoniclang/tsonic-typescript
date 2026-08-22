import type { Node } from "@tsonic/tsts";
import type { TargetSourceProgram } from "@tsonic/target-api/source";
import { KindCallExpression, KindIdentifier } from "@tsonic/tsts/target-ast";

import type { TargetProgramIndex } from "../../../program-index.js";
import type { InvocationTransportContract } from "../../../invocation-transport.js";
import type { ExactAggregateProjectionIndex } from "../aggregate/projection.js";
import type { ExactInvocationInputIndex } from "../invocation/inputs.js";
import type { ExactObjectPropertyProjectionIndex } from "../object/projection.js";
import type { ClosedStorageOwnerAnalysis } from "../storage/analysis.js";
import { createResultConsumerGraph } from "./consumer/graph.js";

export interface CooperativeResultConsumption {
  returnedCallHasClosedConsumers(call: Node): boolean;
  evidence(): CooperativeResultConsumptionEvidence;
}

export interface CooperativeResultConsumptionEvidence {
  readonly callEntries: number;
  readonly referenceEntries: number;
  readonly ownerEvaluations: number;
  readonly consumerEdges: number;
}

export function createCooperativeResultConsumption(
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
): CooperativeResultConsumption {
  const graph = createResultConsumerGraph(
    source,
    program,
    queries,
    candidates,
    invocationInputs,
    projections,
    objectProjections,
    storageOwners.owners,
    exactCallImplementations,
    transports,
    callableReferenceIsClosed,
  );
  const evidence = Object.freeze({
    callEntries: program.nodesOfKind(KindCallExpression).length,
    referenceEntries: program.nodesOfKind(KindIdentifier).length,
    ownerEvaluations: graph.ownerEvaluations,
    consumerEdges: graph.consumerEdges,
  });
  return Object.freeze({
    returnedCallHasClosedConsumers(call: Node): boolean {
      return graph.callHasClosedConsumers(call);
    },
    evidence(): CooperativeResultConsumptionEvidence {
      return evidence;
    },
  });
}
