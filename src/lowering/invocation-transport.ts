import type { Node } from "@tsonic/tsts";

export interface InvocationTransport {
  readonly inputs: readonly Node[];
  readonly resultInputs: readonly Node[];
}

export interface InvocationTransportContract {
  transportFor(call: Node): InvocationTransport | undefined;
}
