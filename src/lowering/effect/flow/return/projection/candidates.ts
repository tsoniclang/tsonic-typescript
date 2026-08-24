import type { Node } from "@tsonic/tsts";
import type { TargetSourceProgram } from "@tsonic/target-api/source";

import type { ExactAggregateProjectionIndex } from "../../aggregate/projection.js";
import type { ExactInvocationInputIndex } from "../../invocation/inputs.js";
import type { ExactObjectPropertyProjectionIndex } from "../../object/projection.js";
import type { ExactValueSlotCallSource } from "../../value/slot/model.js";
import { isFunctionLike, transparentExpression } from "../../../model/syntax.js";
import type { ReturnLocalFlow } from "../local.js";
import { staticallyNonThenable } from "../provenance/semantics.js";
import type { ReturnStorageFlow } from "../storage.js";
import type { ExactCallableBodyInspection } from "../../callable/result-inputs.js";

export interface ReturnProjectionCandidateContext {
  readonly source: TargetSourceProgram;
  readonly projections: ExactAggregateProjectionIndex;
  readonly queryRoots: readonly Node[];
  readonly locals: ReturnLocalFlow;
  readonly storage: ReturnStorageFlow;
  readonly objectProjections: ExactObjectPropertyProjectionIndex;
  readonly invocationInputs: ExactInvocationInputIndex;
  readonly sourceForCall: (
    call: Node,
  ) => ExactValueSlotCallSource | undefined;
  readonly bodyInspectionIsCertified?: ExactCallableBodyInspection;
}

export function collectReturnProjectionCandidates(
  context: ReturnProjectionCandidateContext,
): readonly Node[] {
  const { source } = context;
  const projectionRoots = new Set(context.projections.roots);
  const selected = new Set<Node>();
  const visited = new Set<Node>();
  const pending = [...context.queryRoots];
  for (;;) {
    const expression = pending.pop();
    if (expression === undefined) {
      break;
    }
    const root = transparentExpression(source, expression) ?? expression;
    if (visited.has(root)) {
      continue;
    }
    const nodes = [root];
    while (nodes.length !== 0) {
      const node = nodes.pop();
      if (node === undefined || visited.has(node)) {
        continue;
      }
      visited.add(node);
      if (
        projectionRoots.has(node) &&
        !staticallyNonThenable(
          source,
          node,
          context.bodyInspectionIsCertified,
        )
      ) {
        selected.add(node);
      }
      appendValueDependencies(node, context, pending);
      if (isFunctionLike(source, node)) {
        continue;
      }
      for (const child of source.ast.children(node)) {
        if (child !== undefined) {
          nodes.push(child);
        }
      }
    }
  }
  return Object.freeze(
    context.projections.roots.filter((expression) => selected.has(expression)),
  );
}

function appendValueDependencies(
  node: Node,
  context: ReturnProjectionCandidateContext,
  pending: Node[],
): void {
  const { source } = context;
  const objectProjection = context.objectProjections.projectionFor(node);
  if (objectProjection !== undefined) {
    pending.push(...objectProjection.initializers);
  }
  const local = source.ast.is.IsIdentifier(node)
    ? context.locals.bindingFor(node)
    : undefined;
  const stored = local === undefined && (
      source.ast.is.IsIdentifier(node) ||
      source.ast.is.IsPropertyAccessExpression(node) ||
      source.ast.is.IsElementAccessExpression(node)
    )
    ? context.storage.bindingFor(node)
    : undefined;
  const binding = local ?? stored;
  if (binding !== undefined) {
    pending.push(...binding.inputs);
  }
  if (source.ast.is.IsIdentifier(node)) {
    const declaration = source.navigation.sourceReferenceFor(node)?.declaration;
    if (
      declaration !== undefined &&
      source.ast.is.IsParameterDeclaration(declaration) &&
      context.invocationInputs.isClosed(declaration)
    ) {
      pending.push(...(context.invocationInputs.inputsFor(declaration) ?? []));
    }
  }
  if (source.ast.is.IsCallExpression(node)) {
    for (const expression of context.sourceForCall(node)?.expressions ?? []) {
      if (expression !== undefined) {
        pending.push(expression);
      }
    }
  }
}
