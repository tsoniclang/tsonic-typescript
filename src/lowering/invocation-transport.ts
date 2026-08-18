import type { Node } from "@tsonic/tsts";

export interface InvocationTransport {
  readonly inputExpressions: readonly Node[];
  readonly resultOriginExpressions?: readonly Node[];
}

export interface InvocationTransportContract {
  transportFor(call: Node): InvocationTransport | undefined;
}
