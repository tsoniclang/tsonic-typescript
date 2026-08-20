import type { Node } from "@tsonic/tsts";
import type { TargetSourceProgram } from "@tsonic/target-api";

import type { TargetProgramIndex } from "../../../program-index.js";
import type { InvocationTransportContract } from "../../../invocation-transport.js";
import type { ExactAggregateProjectionIndex } from "../aggregate/projection.js";
import { createExactValueSlotFlow } from "../value/slot/flow.js";
import { exactCallableReturnExpressions } from "../invocation/results.js";
import { callableDispatchIsClosed } from "../../model/syntax.js";
import type { ExactInvocationInputIndex } from "../invocation/inputs.js";

export interface ReturnProjectionFlow {
  isDefinitelyNonThenable(
    expression: Node,
    expressionProof: (expression: Node) => boolean,
  ): boolean;
}

export function createReturnProjectionFlow(
  source: TargetSourceProgram,
  program: TargetProgramIndex,
  projections: ExactAggregateProjectionIndex,
  callDeclarations: (call: Node) => Iterable<Node>,
  invocationInputs: ExactInvocationInputIndex,
  transports?: InvocationTransportContract,
): ReturnProjectionFlow {
  const returns = new Map<Node, readonly (Node | undefined)[] | null>();
  const slots = createExactValueSlotFlow(
    source,
    program,
    projections,
    (call) => {
      const transport = transports?.transportFor(call);
      if (transport?.resultOriginExpressions !== undefined) {
        return Object.freeze({
          declaration: call,
          contracts: Object.freeze([]),
          expressions: Object.freeze([...transport.resultOriginExpressions]),
        });
      }
      const declarations = [...new Set(callDeclarations(call))];
      if (declarations.length === 0) {
        return undefined;
      }
      const expressions: (Node | undefined)[] = [];
      for (const declaration of declarations) {
        if (
          !source.navigation.isProjectDeclaration(declaration) ||
          !callableDispatchIsClosed(source, program, declaration)
        ) {
          return undefined;
        }
        let selected = returns.get(declaration);
        if (selected === undefined) {
          selected = exactCallableReturnExpressions(source, declaration) ?? null;
          returns.set(declaration, selected);
        }
        if (selected === null) {
          return undefined;
        }
        expressions.push(...selected);
      }
      const declaration = declarations[0];
      return declaration === undefined
        ? undefined
        : Object.freeze({
            declaration,
            contracts: Object.freeze(declarations),
            expressions: Object.freeze(expressions),
          });
    },
    invocationInputs,
  );
  return Object.freeze({
    isDefinitelyNonThenable(
      expression: Node,
      expressionProof: (expression: Node) => boolean,
    ): boolean {
      const result = slots.resultFor(expression);
      return result?.closed === true &&
        result.expressions.every(expressionProof);
    },
  });
}
