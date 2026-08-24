import type { Node } from "@tsonic/tsts";
import type { TargetSourceProgram } from "@tsonic/target-api/source";

import type {
  InvocationTransport,
  InvocationTransportContract,
} from "../../../invocation-transport.js";
import type { TargetProgramIndex } from "../../../program-index.js";
import type { ProviderInvocationFact } from "./fact.js";
import { collectProviderInvocationRecords } from "./records.js";
import { createProviderStateTransportPlan } from "./state.js";
import type { ExactSourceBodyInspection } from "../../model/source-membership.js";

export interface ConditionalProviderInvocation {
  readonly call: Node;
  readonly fact: ProviderInvocationFact;
  readonly callableExpressions?: readonly Node[];
}

export interface ProviderInvocationFlow {
  readonly transport?: InvocationTransportContract;
  readonly conditionalCalls: readonly ConditionalProviderInvocation[];
  conditionalFor(call: Node | undefined): ConditionalProviderInvocation | undefined;
}

export function createProviderInvocationFlow(
  source: TargetSourceProgram,
  program: TargetProgramIndex,
  bodyInspectionIsCertified?: ExactSourceBodyInspection,
): ProviderInvocationFlow {
  const records = collectProviderInvocationRecords(source, program);
  if (records.all.length === 0) {
    return emptyProviderInvocationFlow;
  }
  const state = createProviderStateTransportPlan(
    source,
    program,
    records,
    bodyInspectionIsCertified,
  );
  const transports = new Map<Node, InvocationTransport>();
  const conditionalCalls: ConditionalProviderInvocation[] = [];
  const conditionalByCall = new Map<Node, ConditionalProviderInvocation>();
  for (const record of records.all) {
    if (
      record.fact.state?.kind !== "access" ||
      state.isClosed(record.call)
    ) {
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
    const conditional = record.fact.conditional;
    if (
      conditional === undefined ||
      !hasRewritableConditionalTarget(source, record.call, record.fact)
    ) {
      continue;
    }
    const callableExpressions: Node[] = [];
    let complete = true;
    for (const parameter of conditional.callableParameters) {
      const expression = record.expressionFor(parameter);
      if (expression === undefined) {
        complete = false;
        break;
      }
      callableExpressions.push(expression);
    }
    const selected = Object.freeze({
      call: record.call,
      fact: record.fact,
      ...(complete
        ? { callableExpressions: Object.freeze(callableExpressions) }
        : {}),
    });
    conditionalCalls.push(selected);
    conditionalByCall.set(record.call, selected);
  }
  const transport = transports.size === 0
    ? undefined
    : Object.freeze({
        transportFor(call: Node): InvocationTransport | undefined {
          return transports.get(call);
        },
      });
  return Object.freeze({
    ...(transport === undefined ? {} : { transport }),
    conditionalCalls: Object.freeze(conditionalCalls),
    conditionalFor(call: Node | undefined): ConditionalProviderInvocation | undefined {
      return call === undefined ? undefined : conditionalByCall.get(call);
    },
  });
}

function hasRewritableConditionalTarget(
  source: TargetSourceProgram,
  call: Node,
  fact: ProviderInvocationFact,
): boolean {
  const selectedCall = source.ast.as.AsCallExpression(call);
  const expression = selectedCall?.Expression;
  const access = expression !== undefined &&
      source.ast.is.IsPropertyAccessExpression(expression)
    ? source.ast.as.AsPropertyAccessExpression(expression)
    : undefined;
  return fact.target.access === "export" &&
    fact.conditional?.replacement.access === "export" &&
    access !== undefined &&
    source.ast.text(access.name) === fact.target.exportName;
}

const emptyProviderInvocationFlow: ProviderInvocationFlow = Object.freeze({
  conditionalCalls: Object.freeze([]),
  conditionalFor(): ConditionalProviderInvocation | undefined {
    return undefined;
  },
});
