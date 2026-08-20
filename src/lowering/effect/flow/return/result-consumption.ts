import type { Node } from "@tsonic/tsts";
import type { TargetSourceProgram } from "@tsonic/target-api";
import { KindCallExpression, KindIdentifier } from "@tsonic/tsts/target-ast";

import type { TargetProgramIndex } from "../../../program-index.js";
import type { InvocationTransportContract } from "../../../invocation-transport.js";
import type { ExactAggregateProjectionIndex } from "../aggregate/projection.js";
import type { ExactInvocationInputIndex } from "../invocation/inputs.js";
import type { ExactObjectPropertyProjectionIndex } from "../object/projection.js";
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
  candidates: ReadonlySet<Node>,
  invocationInputs: ExactInvocationInputIndex,
  projections: ExactAggregateProjectionIndex,
  objectProjections: ExactObjectPropertyProjectionIndex,
  exactCallImplementations?: (call: Node) => readonly Node[] | undefined,
  transports?: InvocationTransportContract,
  callableReferenceIsClosed?: (reference: Node) => boolean,
): CooperativeResultConsumption {
  const graph = createResultConsumerGraph(
    source,
    program,
    candidates,
    invocationInputs,
    projections,
    objectProjections,
    exactCallImplementations,
    transports,
    callableReferenceIsClosed,
  );
  return Object.freeze({
    returnedCallHasClosedConsumers(call: Node): boolean {
      return graph.callHasClosedConsumers(call);
    },
    evidence(): CooperativeResultConsumptionEvidence {
      return Object.freeze({
        callEntries: program.nodesOfKind(KindCallExpression).length,
        referenceEntries: program.nodesOfKind(KindIdentifier).length,
        ownerEvaluations: graph.ownerEvaluations,
        consumerEdges: graph.consumerEdges,
      });
    },
  });
}
