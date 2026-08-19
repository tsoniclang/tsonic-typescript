import type { Node } from "@tsonic/tsts";
import type { TargetSourceProgram } from "@tsonic/target-api";

import type {
  InvocationTransport,
  InvocationTransportContract,
} from "../../../invocation-transport.js";
import type { TargetProgramIndex } from "../../../program-index.js";
import { collectProviderInvocationRecords } from "./records.js";
import { createProviderStateTransportPlan } from "./state.js";

export function createProviderInvocationTransport(
  source: TargetSourceProgram,
  program: TargetProgramIndex,
): InvocationTransportContract | undefined {
  const records = collectProviderInvocationRecords(source, program);
  if (records.all.length === 0) {
    return undefined;
  }
  const state = createProviderStateTransportPlan(source, program, records);
  const transports = new Map<Node, InvocationTransport>();
  for (const record of records.all) {
    if (
      record.fact.state?.kind === "access" &&
      !state.isClosed(record.call)
    ) {
      continue;
    }
    const resultOrigins = [
      ...record.expressionsFor(record.fact.resultOriginParameters),
      ...state.resultOriginsFor(record.call),
    ];
    transports.set(record.call, Object.freeze({
      inputExpressions: record.expressionsFor(record.fact.inputParameters),
      ...(resultOrigins.length === 0
        ? {}
        : {
            resultOriginExpressions: Object.freeze([
              ...new Set(resultOrigins),
            ]),
          }),
    }));
  }
  return Object.freeze({
    transportFor(call: Node): InvocationTransport | undefined {
      return transports.get(call);
    },
  });
}
