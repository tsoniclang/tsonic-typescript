import type { Node } from "@tsonic/tsts";
import type { TargetSourceProgram } from "@tsonic/target-api/source";

import {
  isInvocationTransportInput,
  type InvocationTransportContract,
} from "../../../invocation-transport.js";
import type { CallableResultInputs } from "./result-inputs.js";

export type CallableInputUse =
  | { readonly kind: "terminal" }
  | { readonly kind: "projection"; readonly outputs: readonly Node[] };

export interface CallableInputUseContract {
  readonly invocationTransports: InvocationTransportContract | undefined;
  useFor(reference: Node): CallableInputUse | undefined;
}

const terminalUse: CallableInputUse = Object.freeze({ kind: "terminal" });

export function createCallableInputUseContract(
  source: TargetSourceProgram,
  projections: CallableResultInputs,
  invocationTransports: InvocationTransportContract | undefined,
): CallableInputUseContract {
  return Object.freeze({
    invocationTransports,
    useFor(reference: Node): CallableInputUse | undefined {
      const invocation = isInvocationTransportInput(
        source,
        reference,
        invocationTransports,
      );
      const outputs = projections.projectionOutputsFor(reference);
      if (invocation && outputs !== undefined) {
        throw new Error("callable input has multiple transport owners");
      }
      if (invocation) {
        return terminalUse;
      }
      return outputs === undefined
        ? undefined
        : Object.freeze({ kind: "projection", outputs });
    },
  });
}
