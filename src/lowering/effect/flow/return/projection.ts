import type { Node } from "@tsonic/tsts";
import type { TargetSourceProgram } from "@tsonic/target-api";

import {
  isFunctionLike,
  transparentExpression,
} from "../../model/syntax.js";
import type { ExactAggregateProjectionIndex } from "../aggregate/projection.js";

export interface ReturnProjectionFlow {
  isDefinitelyNonThenable(
    expression: Node,
    expressionProof: (expression: Node) => boolean,
  ): boolean;
}

export function createReturnProjectionFlow(
  source: TargetSourceProgram,
  projections: ExactAggregateProjectionIndex,
  directCallDeclaration: (call: Node) => Node | undefined,
): ReturnProjectionFlow {
  const slotResults = new Map<Node, Map<number, boolean>>();
  const pending = new Map<Node, Set<number>>();

  return Object.freeze({
    isDefinitelyNonThenable(
      expression: Node,
      expressionProof: (expression: Node) => boolean,
    ): boolean {
      const projection = projections.projectionFor(expression);
      if (projection === undefined) {
        return false;
      }
      const callSlotIsNonThenable = (
        call: Node,
        index: number,
      ): boolean => proveCallSlot(
        source,
        call,
        index,
        projections,
        directCallDeclaration,
        expressionProof,
        slotResults,
        pending,
        callSlotIsNonThenable,
      );
      return sourceSlotIsNonThenable(
        source,
        projection.source.initializer,
        projection.index,
        projections,
        directCallDeclaration,
        callSlotIsNonThenable,
        expressionProof,
      );
    },
  });
}

function proveCallSlot(
  source: TargetSourceProgram,
  call: Node,
  index: number,
  projections: ExactAggregateProjectionIndex,
  directCallDeclaration: (call: Node) => Node | undefined,
  expressionProof: (expression: Node) => boolean,
  slotResults: Map<Node, Map<number, boolean>>,
  pending: Map<Node, Set<number>>,
  callSlotIsNonThenable: (call: Node, index: number) => boolean,
): boolean {
  const declaration = directCallDeclaration(call);
  if (declaration === undefined) {
    return false;
  }
  const cached = slotResults.get(declaration)?.get(index);
  if (cached !== undefined) {
    return cached;
  }
  const declarationPending = pending.get(declaration);
  if (declarationPending?.has(index) === true) {
    return false;
  }
  if (declarationPending === undefined) {
    pending.set(declaration, new Set([index]));
  } else {
    declarationPending.add(index);
  }
  const returned = directReturnExpressions(source, declaration);
  const result = returned !== undefined &&
    returned.length !== 0 &&
    returned.every((expression) =>
      slotValueIsDefinitelyNonThenable(
        source,
        expression,
        index,
        projections,
        directCallDeclaration,
        callSlotIsNonThenable,
        expressionProof,
      )
    );
  pending.get(declaration)?.delete(index);
  const results = slotResults.get(declaration);
  if (results === undefined) {
    slotResults.set(declaration, new Map([[index, result]]));
  } else {
    results.set(index, result);
  }
  return result;
}

function directReturnExpressions(
  source: TargetSourceProgram,
  declaration: Node,
): readonly Node[] | undefined {
  const body = source.ast.body(declaration);
  if (body === undefined) {
    return undefined;
  }
  if (
    source.ast.is.IsArrowFunction(declaration) &&
    !source.ast.is.IsBlock(body)
  ) {
    return [body];
  }
  const returns: Node[] = [];
  const work = [body];
  while (work.length !== 0) {
    const node = work.pop();
    if (node === undefined) {
      continue;
    }
    if (node !== body && isFunctionLike(source, node)) {
      continue;
    }
    if (source.ast.is.IsReturnStatement(node)) {
      const expression = source.ast.as.AsReturnStatement(node)?.Expression;
      if (expression === undefined) {
        return undefined;
      }
      returns.push(expression);
      continue;
    }
    for (const child of source.ast.children(node)) {
      if (child !== undefined) {
        work.push(child);
      }
    }
  }
  if (returns.length === 0) {
    return undefined;
  }
  return returns;
}

function slotValueIsDefinitelyNonThenable(
  source: TargetSourceProgram,
  expression: Node,
  index: number,
  projections: ExactAggregateProjectionIndex,
  directCallDeclaration: (call: Node) => Node | undefined,
  callSlotIsNonThenable: (call: Node, index: number) => boolean,
  expressionIsDefinitelyNonThenable: (expression: Node) => boolean,
): boolean {
  const value = unwrapAwait(source, expression);
  if (value === undefined) {
    return false;
  }
  if (source.ast.is.IsConditionalExpression(value)) {
    const conditional = source.ast.as.AsConditionalExpression(value);
    return conditional?.WhenTrue !== undefined &&
      conditional.WhenFalse !== undefined &&
      slotValueIsDefinitelyNonThenable(
          source,
          conditional.WhenTrue,
          index,
          projections,
          directCallDeclaration,
          callSlotIsNonThenable,
          expressionIsDefinitelyNonThenable,
        ) &&
      slotValueIsDefinitelyNonThenable(
          source,
          conditional.WhenFalse,
          index,
          projections,
          directCallDeclaration,
          callSlotIsNonThenable,
          expressionIsDefinitelyNonThenable,
        );
  }
  if (source.ast.is.IsArrayLiteralExpression(value)) {
    const selected = source.ast.elements(value)[index];
    return selected !== undefined &&
      !source.ast.is.IsSpreadElement(selected) &&
      expressionIsDefinitelyNonThenable(selected);
  }
  if (source.ast.is.IsCallExpression(value)) {
    return directCallDeclaration(value) !== undefined &&
      callSlotIsNonThenable(value, index);
  }
  if (source.ast.is.IsIdentifier(value)) {
    const aggregate = projections.sourceForReference(value);
    return aggregate !== undefined &&
      slotValueIsDefinitelyNonThenable(
          source,
          aggregate.initializer,
          index,
          projections,
          directCallDeclaration,
          callSlotIsNonThenable,
          expressionIsDefinitelyNonThenable,
        );
  }
  return false;
}

function sourceSlotIsNonThenable(
  source: TargetSourceProgram,
  aggregateSource: Node,
  index: number,
  projections: ExactAggregateProjectionIndex,
  directCallDeclaration: (call: Node) => Node | undefined,
  callSlotIsNonThenable: (call: Node, index: number) => boolean,
  expressionIsDefinitelyNonThenable: (expression: Node) => boolean,
): boolean {
  return slotValueIsDefinitelyNonThenable(
    source,
    aggregateSource,
    index,
    projections,
    directCallDeclaration,
    callSlotIsNonThenable,
    expressionIsDefinitelyNonThenable,
  );
}

function unwrapAwait(
  source: TargetSourceProgram,
  expression: Node | undefined,
): Node | undefined {
  const root = transparentExpression(source, expression);
  return root !== undefined && source.ast.is.IsAwaitExpression(root)
    ? transparentExpression(
        source,
        source.ast.as.AsAwaitExpression(root)?.Expression,
      )
    : root;
}
