import type { Node } from "@tsonic/tsts";

import type { ExactInvocationInputIndex } from "../inputs.js";
import type { ExactIndirectInvocationFacts } from "./model.js";

export function finalizeExactIndirectInvocationFacts(
  invocationInputs: ExactInvocationInputIndex,
  implementations: ReadonlyMap<Node, readonly Node[]>,
  callableReferences: ReadonlySet<Node>,
): ExactIndirectInvocationFacts {
  return Object.freeze({
    invocationInputs,
    implementationsFor(call: Node): readonly Node[] | undefined {
      return implementations.get(call);
    },
    allowsCallableReference(reference: Node): boolean {
      return callableReferences.has(reference);
    },
  });
}
