import type { Node } from "@tsonic/tsts";

import type { InvocationTransportContract } from "../../../../invocation-transport.js";
import type { TypeScriptPlanningObserver } from "../../../../planning-observer.js";
import type { ExactCallImplementations } from "../../callable/result-inputs.js";
import type { ExactInvocationInputIndex } from "../inputs.js";

export interface ExactIndirectCallableInvocation {
  readonly call: Node;
  readonly implementations: readonly Node[];
}

export interface ExactIndirectInvocationAnalysis {
  readonly invocationInputs: ExactInvocationInputIndex;
  implementationsFor(call: Node): readonly Node[] | undefined;
  allowsCallableReference(reference: Node): boolean;
  refine(
    invocationInputs: ExactInvocationInputIndex,
    transports: InvocationTransportContract | undefined,
    callImplementations: ExactCallImplementations | undefined,
    planningObserver?: TypeScriptPlanningObserver,
  ): ExactIndirectInvocationAnalysis;
}

export interface ExactIndirectInvocationRound {
  readonly invocations: readonly ExactIndirectCallableInvocation[];
  readonly callableReferences: ReadonlySet<Node>;
}
