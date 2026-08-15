import type { Node } from "@tsonic/tsts";

export interface StorageOwnerInvocationTransport {
  readonly inputs: readonly Node[];
  readonly resultInputs: readonly Node[];
}

export interface StorageOwnerTransportContract {
  transportFor(call: Node): StorageOwnerInvocationTransport | undefined;
}
