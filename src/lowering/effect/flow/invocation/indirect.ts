import type { Node } from "@tsonic/tsts";
import type { TargetSourceProgram } from "@tsonic/target-api";
import { KindCallExpression } from "@tsonic/tsts/target-ast";

import type { TargetProgramIndex } from "../../../program-index.js";
import { resolveProjectInvocation } from "../../model/project-invocation.js";
import {
  callableDispatchIsClosed,
  exactCallableTarget,
  isFunctionLike,
  transparentExpression,
} from "../../model/syntax.js";
import { collectCallableValueInputs } from "../callable/value-inputs.js";
import type { ExactAggregateProjectionIndex } from "../aggregate/projection.js";
import type { ExactInvocationInputIndex } from "./inputs.js";
import { extendExactInvocationInputIndex } from "./implementation-inputs.js";
import { sameValueAlternatives } from "../value/alternatives.js";

export interface ExactIndirectCallableInvocation {
  readonly call: Node;
  readonly implementations: readonly Node[];
}

export function createExactIndirectInvocationInputIndex(
  source: TargetSourceProgram,
  program: TargetProgramIndex,
  direct: ExactInvocationInputIndex,
  projections?: ExactAggregateProjectionIndex,
): ExactInvocationInputIndex {
  return extendExactInvocationInputIndex(
    source,
    direct,
    collectExactIndirectCallableInvocations(source, program, direct).map(
      ({ call, implementations }) => Object.freeze({
        calls: Object.freeze([call]),
        implementations,
      }),
    ),
    projections,
  );
}

export function collectExactIndirectCallableInvocations(
  source: TargetSourceProgram,
  program: TargetProgramIndex,
  direct: ExactInvocationInputIndex,
): readonly ExactIndirectCallableInvocation[] {
  const values = collectCallableValueInputs(
    source,
    program,
    undefined,
    direct,
  );
  const result: ExactIndirectCallableInvocation[] = [];
  for (const call of program.nodesOfKind(KindCallExpression)) {
    if (resolveProjectInvocation(source, call) !== undefined) {
      continue;
    }
    const target = exactCallableTarget(
      source,
      source.ast.as.AsCallExpression(call)?.Expression,
    );
    const implementations = target === undefined
      ? undefined
      : resolveCallableExpressions(
          source,
          program,
          values,
          target,
          new Set(),
        );
    if (implementations !== undefined && implementations.length !== 0) {
      result.push(Object.freeze({
        call,
        implementations: Object.freeze([...new Set(implementations)]),
      }));
    }
  }
  return Object.freeze(result);
}

function resolveCallableExpressions(
  source: TargetSourceProgram,
  program: TargetProgramIndex,
  values: ReturnType<typeof collectCallableValueInputs>,
  expression: Node,
  pending: ReadonlySet<Node>,
): readonly Node[] | undefined {
  const root = transparentExpression(source, expression);
  if (root === undefined || pending.has(root)) {
    return undefined;
  }
  if (
    source.ast.is.IsArrowFunction(root) ||
    source.ast.is.IsFunctionExpression(root)
  ) {
    return Object.freeze([root]);
  }
  const alternatives = sameValueAlternatives(source, root);
  if (alternatives === null) {
    return undefined;
  }
  if (alternatives !== undefined) {
    const implementations: Node[] = [];
    for (const alternative of alternatives) {
      const resolved = resolveCallableExpressions(
        source,
        program,
        values,
        alternative,
        new Set([...pending, root]),
      );
      if (resolved === undefined) {
        return undefined;
      }
      implementations.push(...resolved);
    }
    return Object.freeze([...new Set(implementations)]);
  }
  const referenceNode = source.ast.is.IsPropertyAccessExpression(root)
    ? source.ast.name(root)
    : root;
  const reference = program.declarationReferenceFor(referenceNode);
  if (
    reference?.project === true &&
    isFunctionLike(source, reference.declaration) &&
    source.ast.body(reference.declaration) !== undefined &&
    callableDispatchIsClosed(source, program, reference.declaration)
  ) {
    return Object.freeze([reference.declaration]);
  }
  if (
    reference?.project !== true ||
    !values.isClosed(reference.declaration)
  ) {
    return undefined;
  }
  const inputs = values.valuesFor(reference.declaration);
  if (inputs === undefined || inputs.length === 0) {
    return undefined;
  }
  const implementations: Node[] = [];
  for (const input of inputs) {
    const resolved = resolveCallableExpressions(
      source,
      program,
      values,
      input,
      new Set([...pending, root]),
    );
    if (resolved === undefined) {
      return undefined;
    }
    implementations.push(...resolved);
  }
  return Object.freeze([...new Set(implementations)]);
}
