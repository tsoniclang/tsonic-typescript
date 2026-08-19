import type { Node } from "@tsonic/tsts";
import { KindCallExpression } from "@tsonic/tsts/target-ast";

import type { InvocationTransportContract } from "../../../invocation-transport.js";
import type { TargetProgramIndex } from "../../../program-index.js";

export function forEachInvocationTransportInput(
  program: TargetProgramIndex,
  transports: InvocationTransportContract | undefined,
  visitor: (input: Node) => void,
): void {
  if (transports === undefined) {
    return;
  }
  for (const call of program.nodesOfKind(KindCallExpression)) {
    for (const input of transports.transportFor(call)?.inputExpressions ?? []) {
      visitor(input);
    }
  }
}

export function invocationTransportResultOrigins(
  call: Node,
  transports: InvocationTransportContract | undefined,
): readonly Node[] | undefined {
  return transports?.transportFor(call)?.resultOriginExpressions;
}
