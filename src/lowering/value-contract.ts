import type { Node } from "@tsonic/tsts";

export type LoweredInputProof = (input: Node) => boolean;

export interface LoweredValueContract {
  isDefinitelyNonThenable(
    expression: Node,
    proveInput: LoweredInputProof,
  ): boolean;
}

export function composeLoweredValueContracts(
  contracts: readonly LoweredValueContract[],
): LoweredValueContract {
  const selected = Object.freeze([...contracts]);
  return Object.freeze({
    isDefinitelyNonThenable(
      expression: Node,
      proveInput: LoweredInputProof,
    ): boolean {
      return selected.some((contract) =>
        contract.isDefinitelyNonThenable(expression, proveInput)
      );
    },
  });
}
