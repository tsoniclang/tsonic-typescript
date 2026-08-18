import type { Node } from "@tsonic/tsts";

export interface InvocationTransport {
  readonly inputExpressions: readonly Node[];
  readonly resultOriginExpressions?: readonly Node[];
}

export interface InvocationTransportContract {
  transportFor(call: Node): InvocationTransport | undefined;
}

export function composeInvocationTransportContracts(
  contracts: readonly (InvocationTransportContract | undefined)[],
): InvocationTransportContract | undefined {
  const selected = contracts.filter(
    (contract): contract is InvocationTransportContract =>
      contract !== undefined,
  );
  if (selected.length === 0) {
    return undefined;
  }
  if (selected.length === 1) {
    return selected[0];
  }
  return Object.freeze({
    transportFor(call: Node): InvocationTransport | undefined {
      let result: InvocationTransport | undefined;
      for (const contract of selected) {
        const candidate = contract.transportFor(call);
        if (candidate === undefined) {
          continue;
        }
        if (result !== undefined) {
          throw new Error(
            "invocation transport has multiple semantic owners",
          );
        }
        result = candidate;
      }
      return result;
    },
  });
}
