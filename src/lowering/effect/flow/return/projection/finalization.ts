import type { Node } from "@tsonic/tsts";

export interface ReturnProjectionFlow {
  isDefinitelyNonThenable(
    expression: Node,
    expressionProof: (expression: Node) => boolean,
  ): boolean;
}

export function finalizeReturnProjectionFlow(
  closedInputs: ReadonlyMap<Node, readonly Node[]>,
): ReturnProjectionFlow {
  return Object.freeze({
    isDefinitelyNonThenable(
      expression: Node,
      expressionProof: (expression: Node) => boolean,
    ): boolean {
      const inputs = closedInputs.get(expression);
      return inputs !== undefined && inputs.every(expressionProof);
    },
  });
}
