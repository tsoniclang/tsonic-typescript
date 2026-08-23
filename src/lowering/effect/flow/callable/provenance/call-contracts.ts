import type { Node } from "@tsonic/tsts";

import {
  callableReturnRewrite,
  callableReturnRewriteAdmitsDirectValue,
  type CallableReturnRewrite,
} from "../../../model/callable-contract.js";
import { exactCallableTarget } from "../../../model/syntax.js";
import { exactCallableReturnExpressions } from "../../invocation/results.js";
import type {
  CallableContext,
  CallableState,
} from "../provenance-flow.js";
import type {
  CallableReturnContractSource,
} from "./return-contracts.js";

export interface CallableReturnContractState {
  readonly returnTypes: readonly CallableReturnRewrite[];
  readonly state: CallableState;
  readonly sources: readonly CallableReturnContractSource[];
}

export function collectCallReturnContractStates(
  context: CallableContext,
): readonly CallableReturnContractState[] {
  const result: CallableReturnContractState[] = [];
  for (const [call, implementations] of context.callImplementations) {
    const selected = selectedCallReturnContract(
      call,
      context,
    );
    if (selected === undefined) {
      continue;
    }
    const returnTypes = new Map<Node, CallableReturnRewrite>();
    for (const rewrite of selected.returnTypes) {
      returnTypes.set(rewrite.target, rewrite);
    }
    const sources: CallableReturnContractSource[] = [
      ...selected.sources,
    ];
    let complete = true;
    for (const implementation of implementations) {
      const returned = exactCallableReturnExpressions(
        context.source,
        implementation,
      );
      if (returned === undefined) {
        complete = false;
        break;
      }
      for (const expression of returned) {
        if (expression === undefined) {
          complete = false;
          break;
        }
        appendSource(sources, expression, "call-result");
      }
      if (!complete) {
        break;
      }
      const returnType = context.source.ast.typeNode(implementation);
      const rewrite = returnType === undefined
        ? undefined
        : callableReturnRewrite(context.source, returnType);
      if (
        rewrite !== undefined &&
        callableReturnRewriteAdmitsDirectValue(context.source, rewrite) &&
        !appendRewrite(returnTypes, rewrite)
      ) {
        complete = false;
        break;
      }
    }
    if (complete && sources.length !== 0) {
      const state = context.calls.get(call);
      if (state === undefined) {
        throw new Error("callable contract has no invocation provenance state");
      }
      result.push(Object.freeze({
        returnTypes: Object.freeze([...returnTypes.values()]),
        state,
        sources: Object.freeze(sources),
      }));
    }
  }
  return Object.freeze(result);
}

interface SelectedCallReturnContract {
  readonly returnTypes: readonly CallableReturnRewrite[];
  readonly sources: readonly CallableReturnContractSource[];
}

function selectedCallReturnContract(
  call: Node,
  context: CallableContext,
): SelectedCallReturnContract | undefined {
  const semantics = context.source.semantics.forNode(call);
  const signature = semantics.operations.call(call)?.selectedSignature;
  const declaration = signature === undefined
    ? undefined
    : semantics.declarations.signatureDeclaration(signature);
  const returnType = declaration === undefined
    ? undefined
    : context.source.ast.typeNode(declaration);
  const rewrite = returnType === undefined
    ? undefined
    : callableReturnRewrite(context.source, returnType);
  if (
    rewrite === undefined ||
    !callableReturnRewriteAdmitsDirectValue(context.source, rewrite)
  ) {
    return undefined;
  }
  const rewrites = new Map<Node, CallableReturnRewrite>([
    [rewrite.target, rewrite],
  ]);
  const target = exactCallableTarget(
    context.source,
    context.source.ast.as.AsCallExpression(call)?.Expression,
  );
  const projection = target === undefined
    ? undefined
    : context.results.resultFor(target);
  if (projection === undefined) {
    return Object.freeze({
      returnTypes: Object.freeze([...rewrites.values()]),
      sources: Object.freeze([]),
    });
  }
  if (
    projection.projectionConsumers !== undefined &&
    !context.inputs.projectionConsumersAreClosed(
      projection.projectionConsumers,
    )
  ) {
    return undefined;
  }
  const sources: CallableReturnContractSource[] = [];
  for (const expression of projection.expressions) {
    if (expression === undefined) {
      return undefined;
    }
    appendSource(sources, expression, "callable-value");
  }
  for (const projected of projection.returnTypes) {
    if (
      !callableReturnRewriteAdmitsDirectValue(context.source, projected) ||
      !appendRewrite(rewrites, projected)
    ) {
      return undefined;
    }
  }
  return Object.freeze({
    returnTypes: Object.freeze([...rewrites.values()]),
    sources: Object.freeze(sources),
  });
}

function appendRewrite(
  rewrites: Map<Node, CallableReturnRewrite>,
  rewrite: CallableReturnRewrite,
): boolean {
  const existing = rewrites.get(rewrite.target);
  if (existing === undefined) {
    rewrites.set(rewrite.target, rewrite);
    return true;
  }
  return existing.selection.kind === rewrite.selection.kind &&
    existing.selection.index === rewrite.selection.index;
}

function appendSource(
  sources: CallableReturnContractSource[],
  expression: Node,
  kind: CallableReturnContractSource["kind"],
): void {
  if (!sources.some((source) =>
    source.expression === expression && source.kind === kind
  )) {
    sources.push(Object.freeze({ expression, kind }));
  }
}
