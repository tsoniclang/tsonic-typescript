import type { Node } from "@tsonic/tsts";
import type { TargetSourceProgram } from "@tsonic/target-api";

import type { TargetProgramIndex } from "../program-index.js";
import {
  callableResultReturnRewrites,
  type CallableReturnRewrite,
} from "./callable-contract.js";
import {
  callableDispatchIsClosed,
  exactCallableTarget,
  isFunctionLike,
  transparentExpression,
} from "./syntax.js";

export interface CallableResultInput {
  readonly declaration: Node;
  readonly expressions: readonly (Node | undefined)[];
  readonly returnTypes: readonly CallableReturnRewrite[];
}

export interface CallableResultInputs {
  resultFor(expression: Node): CallableResultInput | undefined;
}

export function createCallableResultInputs(
  source: TargetSourceProgram,
  program: TargetProgramIndex,
): CallableResultInputs {
  const returns = new Map<Node, readonly (Node | undefined)[] | null>();
  const returnTypes = new Map<
    Node,
    readonly CallableReturnRewrite[] | null
  >();
  const results = new Map<Node, CallableResultInput | null>();
  return Object.freeze({
    resultFor(expression: Node): CallableResultInput | undefined {
      const existing = results.get(expression);
      if (existing !== undefined) {
        return existing ?? undefined;
      }
      const selected = selectedCall(source, expression);
      if (selected === undefined) {
        results.set(expression, null);
        return undefined;
      }
      const semantics = source.semantics.forNode(selected.call);
      const declaration = semantics.getSignatureDeclaration(
        semantics.getResolvedSignature(selected.call),
      );
      const callExpression = source.ast.as.AsCallExpression(selected.call)
        ?.Expression;
      const target = exactCallableTarget(source, callExpression);
      const referenceNode = target !== undefined &&
          source.ast.is.IsPropertyAccessExpression(target)
        ? source.ast.as.AsPropertyAccessExpression(target)?.name
        : source.ast.name(target) ?? target;
      const reference = source.navigation.sourceReferenceFor(referenceNode);
      if (
        declaration === undefined ||
        reference?.declaration !== declaration ||
        !source.navigation.isProjectDeclaration(declaration) ||
        !callableDispatchIsClosed(source, program, declaration) ||
        program.hasBindingWrite(declaration) ||
        (source.ast.hasModifierKind(declaration, "async") && !selected.awaited)
      ) {
        results.set(expression, null);
        return undefined;
      }
      let expressions = returns.get(declaration);
      if (expressions === undefined) {
        expressions = directReturnExpressions(source, declaration) ?? null;
        returns.set(declaration, expressions);
      }
      let rewrites = returnTypes.get(declaration);
      if (rewrites === undefined) {
        rewrites = callableResultReturnRewrites(source, declaration) ?? null;
        returnTypes.set(declaration, rewrites);
      }
      const result = expressions === null || rewrites === null
        ? undefined
        : Object.freeze({ declaration, expressions, returnTypes: rewrites });
      results.set(expression, result ?? null);
      return result;
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
