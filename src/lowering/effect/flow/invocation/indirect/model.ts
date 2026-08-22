import type { Node } from "@tsonic/tsts";

import type { ExactInvocationInputIndex } from "../inputs.js";

export interface ExactIndirectCallableInvocation {
  readonly call: Node;
  readonly implementations: readonly Node[];
}

export interface ExactIndirectInvocationAnalysis {
  readonly invocationInputs: ExactInvocationInputIndex;
  implementationsFor(call: Node): readonly Node[] | undefined;
  allowsCallableReference(reference: Node): boolean;
}

export interface ExactIndirectInvocationRound {
  readonly invocations: readonly ExactIndirectCallableInvocation[];
  readonly callableReferences: ReadonlySet<Node>;
}
