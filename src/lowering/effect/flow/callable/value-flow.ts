import type { Node } from "@tsonic/tsts";
import type { TargetSourceProgram } from "@tsonic/target-api";

import type { InvocationTransportContract } from "../../../invocation-transport.js";
import type { TargetProgramIndex } from "../../../program-index.js";
import type { ExactAggregateProjectionIndex } from "../aggregate/projection.js";
import type { ExactInvocationInputIndex } from "../invocation/inputs.js";
import type { ExactObjectPropertyProjectionIndex } from "../object/projection.js";
import type { CallableReturnRewrite } from "../../model/callable-contract.js";
import {
  createGraphCallableValueFlow,
} from "./provenance-flow.js";
import type { CallableValueResolution } from "./value-resolution.js";
import type { ExactCallImplementations } from "./result-inputs.js";

export type { CallableValueResolution } from "./value-resolution.js";

export interface CallableValueFlow {
  readonly signatureFamilies: readonly (readonly Node[])[];
  forEachCall(
    visitor: (call: Node, resolution: CallableValueResolution) => void,
  ): void;
  resolutionFor(call: Node | undefined): CallableValueResolution | undefined;
  allowsCandidateReference(node: Node): boolean;
  settledReturnTypes(
    optimized: ReadonlySet<Node>,
  ): readonly CallableReturnRewrite[];
}

export function createCallableValueFlow(
  source: TargetSourceProgram,
  program: TargetProgramIndex,
  candidates: ReadonlySet<Node>,
  projections: ExactAggregateProjectionIndex,
  transports?: InvocationTransportContract,
  exactCallImplementations?: ExactCallImplementations,
  invocationInputs?: ExactInvocationInputIndex,
  exactContractImplementations?: ExactCallImplementations,
  objectProjections?: ExactObjectPropertyProjectionIndex,
): CallableValueFlow {
  return createGraphCallableValueFlow(
    source,
    program,
    candidates,
    projections,
    transports,
    exactCallImplementations,
    invocationInputs,
    exactContractImplementations,
    objectProjections,
  );
}
