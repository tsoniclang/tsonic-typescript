import type { Node } from "@tsonic/tsts";

export type LoweredInputProof = (input: Node) => boolean;

export interface LoweredValueContract {
  isDefinitelyNonThenable(
    expression: Node,
    proveInput: LoweredInputProof,
  ): boolean;
}
