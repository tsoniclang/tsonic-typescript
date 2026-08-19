import type { Node } from "@tsonic/tsts";
import type { TargetSourceProgram } from "@tsonic/target-api";

import type { TargetProgramIndex } from "../../../program-index.js";
import type { ExactAggregateProjectionIndex } from "../aggregate/projection.js";
import {
  callableResultReturnRewrites,
  type CallableReturnRewrite,
} from "../../model/callable-contract.js";
import {
  callableDispatchIsClosed,
  isFunctionLike,
  transparentExpression,
} from "../../model/syntax.js";
import { resolveProjectInvocation } from "../../model/project-invocation.js";
import { createCallableProjectionInputs } from "./projection-inputs.js";

export interface CallableResultInput {
  readonly declaration: Node;
  readonly expressions: readonly (Node | undefined)[];
  readonly returnTypes: readonly CallableReturnRewrite[];
  readonly projectionConsumers?: readonly Node[];
}

export interface CallableResultSourceInput {
  readonly declaration: Node;
  readonly expressions: readonly (Node | undefined)[];
}

export interface CallableResultLookup {
  sourceFor(expression: Node): CallableResultSourceInput | undefined;
  resultFor(expression: Node): CallableResultInput | undefined;
}

export interface CallableResultInputs extends CallableResultLookup {
  projectionOutputsFor(reference: Node): readonly Node[] | undefined;
}

export function createCallableResultInputs(
  source: TargetSourceProgram,
  program: TargetProgramIndex,
  projections: ExactAggregateProjectionIndex,
): CallableResultInputs {
  const returns = new Map<Node, readonly (Node | undefined)[] | null>();
  const returnTypes = new Map<
    Node,
    readonly CallableReturnRewrite[] | null
  >();
  const sources = new Map<Node, CallableResultSourceInput | null>();
  const results = new Map<Node, CallableResultInput | null>();
  const sourceFor = (
    expression: Node,
  ): CallableResultSourceInput | undefined => {
    const existing = sources.get(expression);
    if (existing !== undefined) {
      return existing ?? undefined;
    }
    const selected = selectedCall(source, expression);
    if (selected === undefined) {
      sources.set(expression, null);
      return undefined;
    }
    const declaration = resolveProjectInvocation(source, selected.call)
      ?.implementation;
    if (
      declaration === undefined ||
      !source.navigation.isProjectDeclaration(declaration) ||
      !callableDispatchIsClosed(source, program, declaration) ||
      program.hasBindingWrite(declaration) ||
      (source.ast.hasModifierKind(declaration, "async") && !selected.awaited)
    ) {
      sources.set(expression, null);
      return undefined;
    }
    let expressions = returns.get(declaration);
    if (expressions === undefined) {
      expressions = directReturnExpressions(source, declaration) ?? null;
      returns.set(declaration, expressions);
    }
    const result = expressions === null
      ? undefined
      : Object.freeze({ declaration, expressions });
    sources.set(expression, result ?? null);
    return result;
  };
  const directResults: CallableResultLookup = Object.freeze({
    sourceFor,
    resultFor(expression: Node): CallableResultInput | undefined {
      const existing = results.get(expression);
      if (existing !== undefined) {
        return existing ?? undefined;
      }
      const input = sourceFor(expression);
      if (input === undefined) {
        results.set(expression, null);
        return undefined;
      }
      let rewrites = returnTypes.get(input.declaration);
      if (rewrites === undefined) {
        rewrites = callableResultReturnRewrites(source, input.declaration) ??
          null;
        returnTypes.set(input.declaration, rewrites);
      }
      const result = rewrites === null
        ? undefined
        : Object.freeze({
            declaration: input.declaration,
            expressions: input.expressions,
            returnTypes: rewrites,
          });
      results.set(expression, result ?? null);
      return result;
    },
  });
  const projectedResults = createCallableProjectionInputs(
    source,
    program,
    projections,
    directResults,
  );
  return Object.freeze({
    sourceFor,
    resultFor(expression: Node): CallableResultInput | undefined {
      return directResults.resultFor(expression) ??
        projectedResults.resultFor(expression);
    },
    projectionOutputsFor(reference: Node): readonly Node[] | undefined {
      return projectedResults.outputsFor(reference);
    },
  });
}

function selectedCall(
  source: TargetSourceProgram,
  expression: Node,
): { readonly call: Node; readonly awaited: boolean } | undefined {
  const root = transparentExpression(source, expression);
  if (root === undefined) {
    return undefined;
  }
  if (source.ast.is.IsAwaitExpression(root)) {
    const awaited = transparentExpression(
      source,
      source.ast.as.AsAwaitExpression(root)?.Expression,
    );
    return awaited !== undefined && source.ast.is.IsCallExpression(awaited)
      ? { call: awaited, awaited: true }
      : undefined;
  }
  return source.ast.is.IsCallExpression(root)
    ? { call: root, awaited: false }
    : undefined;
}

function directReturnExpressions(
  source: TargetSourceProgram,
  declaration: Node,
): readonly (Node | undefined)[] | undefined {
  const body = source.ast.body(declaration);
  if (body === undefined) {
    return undefined;
  }
  if (!source.ast.is.IsBlock(body)) {
    return Object.freeze([body]);
  }
  const result: (Node | undefined)[] = [];
  const pending = [...source.ast.children(body)].reverse();
  while (pending.length !== 0) {
    const node = pending.pop();
    if (node === undefined || isFunctionLike(source, node)) {
      continue;
    }
    if (source.ast.is.IsReturnStatement(node)) {
      result.push(source.ast.as.AsReturnStatement(node)?.Expression);
      continue;
    }
    const children = source.ast.children(node);
    for (let index = children.length - 1; index >= 0; index -= 1) {
      const child = children[index];
      if (child !== undefined) {
        pending.push(child);
      }
    }
  }
  return Object.freeze(result);
}
