import type { Node } from "@tsonic/tsts";
import type { TargetSourceProgram } from "@tsonic/target-api";
import { KindCallExpression } from "@tsonic/tsts/target-ast";

import type { TargetProgramIndex } from "../../../program-index.js";
import type { ProviderInvocationFact } from "./fact.js";
import { providerInvocationFactKey } from "./fact.js";

export interface ProviderInvocationRecord {
  readonly call: Node;
  readonly fact: ProviderInvocationFact;
  expressionsFor(parameters: readonly number[]): readonly Node[];
  expressionFor(parameter: number): Node | undefined;
}

export interface ProviderInvocationRecords {
  readonly all: readonly ProviderInvocationRecord[];
  forCall(call: Node | undefined): ProviderInvocationRecord | undefined;
}

export function collectProviderInvocationRecords(
  source: TargetSourceProgram,
  program: TargetProgramIndex,
): ProviderInvocationRecords {
  const all: ProviderInvocationRecord[] = [];
  const byCall = new Map<Node, ProviderInvocationRecord>();
  for (const call of program.nodesOfKind(KindCallExpression)) {
    const fact = source.sourceFacts.getFact(call, providerInvocationFactKey);
    if (fact === undefined) {
      continue;
    }
    const selected = source.semantics.forNode(call).getResolvedCallInfo(call);
    if (selected === undefined || selected.call !== call) {
      throw new Error(
        `Provider invocation '${fact.semanticKey}' has no exact checked call`,
      );
    }
    const expressionsByParameter = new Map<number, Node[]>();
    for (const binding of selected.sourceArgumentBindings) {
      const argument = selected.sourceArguments[binding.sourceArgumentIndex]
        ?.expression;
      if (argument === undefined) {
        throw new Error(
          `Provider invocation '${fact.semanticKey}' lost source argument ${binding.sourceArgumentIndex}`,
        );
      }
      const expressions = expressionsByParameter.get(
        binding.sourceParameterIndex,
      );
      if (expressions === undefined) {
        expressionsByParameter.set(binding.sourceParameterIndex, [argument]);
      } else if (!expressions.includes(argument)) {
        expressions.push(argument);
      }
    }
    const record = Object.freeze({
      call,
      fact,
      expressionsFor(parameters: readonly number[]): readonly Node[] {
        const result: Node[] = [];
        for (const parameter of parameters) {
          for (const expression of expressionsByParameter.get(parameter) ?? []) {
            if (!result.includes(expression)) {
              result.push(expression);
            }
          }
        }
        return Object.freeze(result);
      },
      expressionFor(parameter: number): Node | undefined {
        const expressions = expressionsByParameter.get(parameter) ?? [];
        if (expressions.length > 1) {
          throw new Error(
            `Provider invocation '${fact.semanticKey}' state parameter ${parameter} has multiple source arguments`,
          );
        }
        return expressions[0];
      },
    });
    all.push(record);
    byCall.set(call, record);
  }
  return Object.freeze({
    all: Object.freeze(all),
    forCall(call: Node | undefined): ProviderInvocationRecord | undefined {
      return call === undefined ? undefined : byCall.get(call);
    },
  });
}
