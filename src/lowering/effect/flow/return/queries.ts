import type { Node } from "@tsonic/tsts";
import type { TargetSourceProgram } from "@tsonic/target-api/source";
import { KindAwaitExpression } from "@tsonic/tsts/target-ast";

import type { TargetProgramIndex } from "../../../program-index.js";
import type { GraphCallableValueFlow } from "../callable/provenance/finalization.js";
import { exactCallableReturnExpressions } from "../invocation/results.js";

export interface ReturnFlowQueries {
  readonly roots: readonly Node[];
}

export function collectReturnFlowQueries(
  source: TargetSourceProgram,
  program: TargetProgramIndex,
  candidates: ReadonlySet<Node>,
  callableValues: GraphCallableValueFlow,
): ReturnFlowQueries {
  const roots = new Set<Node>();
  for (const awaitExpression of program.nodesOfKind(KindAwaitExpression)) {
    const expression = source.ast.as.AsAwaitExpression(awaitExpression)?.Expression;
    if (expression !== undefined) {
      roots.add(expression);
    }
  }
  for (const declaration of candidates) {
    for (const expression of exactCallableReturnExpressions(source, declaration) ?? []) {
      if (expression !== undefined) {
        roots.add(expression);
      }
    }
  }
  callableValues.forEachCall((call, resolution) => {
    if (resolution.closed && resolution.synchronousDeclarationCount !== 0) {
      roots.add(call);
    }
  });
  return Object.freeze({
    roots: Object.freeze(program.nodes.filter((node) => roots.has(node))),
  });
}
