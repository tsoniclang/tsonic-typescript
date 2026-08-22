import type { Node } from "@tsonic/tsts";
import type { TargetSourceProgram } from "@tsonic/target-api/source";
import { KindCallExpression } from "@tsonic/tsts/target-ast";

import type { TargetProgramIndex } from "../../../../program-index.js";
import type { TypeScriptPlanningObserver } from "../../../../planning-observer.js";
import type { InvocationTransportContract } from "../../../../invocation-transport.js";
import { createEffectProvenanceGraphBuilder } from "../../../provenance/graph.js";
import type { EffectProvenanceVertex } from "../../../provenance/model.js";
import { resolveEffectProvenance } from "../../../provenance/resolution.js";
import {
  callableDispatchIsClosed,
  exactCallableTarget,
  transparentExpression,
} from "../../../model/syntax.js";
import { resolveProjectInvocation } from "../../../model/project-invocation.js";
import { collectCallableValueInputs } from "../../callable/value-inputs.js";
import {
  createCallableResultInputs,
  type ExactCallImplementations,
} from "../../callable/result-inputs.js";
import { createCallableInputUseContract } from "../../callable/input-use.js";
import type { ExactObjectPropertyProjectionIndex } from "../../object/projection.js";
import { sameValueAlternatives } from "../../value/alternatives.js";
import type { CallableFields } from "../../storage/fields.js";
import type { ExactAggregateProjectionIndex } from "../../aggregate/projection.js";
import type { ExactInvocationInputIndex } from "../inputs.js";
import { collectClosedIndirectCallableReferences } from "./reference-closure.js";
import { selectClosedIndirectCallableOrigins } from "./origin-selection.js";
import type {
  ExactIndirectCallableInvocation,
  ExactIndirectInvocationRound,
} from "./model.js";

type IndirectInvocationBoundary =
  | "open-binding"
  | "open-expression"
  | "open-projection";

interface CallableOriginState {
  readonly vertex: EffectProvenanceVertex;
  expanded: boolean;
}

interface CallableOriginContext {
  readonly source: TargetSourceProgram;
  readonly program: TargetProgramIndex;
  readonly values: ReturnType<typeof collectCallableValueInputs>;
  readonly results: ReturnType<typeof createCallableResultInputs>;
  readonly objectProjections: ExactObjectPropertyProjectionIndex;
  readonly transports: InvocationTransportContract | undefined;
  readonly builder: ReturnType<
    typeof createEffectProvenanceGraphBuilder<IndirectInvocationBoundary>
  >;
  readonly expressions: Map<Node, CallableOriginState>;
  readonly declarations: Map<Node, CallableOriginState>;
  readonly callableOrigins: Set<Node>;
}

export function collectExactIndirectInvocationRound(
  source: TargetSourceProgram,
  program: TargetProgramIndex,
  direct: ExactInvocationInputIndex,
  projections: ExactAggregateProjectionIndex,
  objectProjections: ExactObjectPropertyProjectionIndex,
  transports?: InvocationTransportContract,
  exactCallImplementations?: ExactCallImplementations,
  callableReferenceIsClosed?: (reference: Node) => boolean,
  projectionCandidates: readonly Node[] = Object.freeze([]),
  planningObserver?: TypeScriptPlanningObserver,
  callableFields?: CallableFields,
): ExactIndirectInvocationRound {
  const results = createCallableResultInputs(
    source,
    program,
    projections,
    new Set(),
    exactCallImplementations,
    direct,
    projectionCandidates,
    planningObserver,
  );
  planningObserver?.("effect-indirect-results");
  const inputUses = createCallableInputUseContract(
    source,
    results,
    transports,
  );
  const values = collectCallableValueInputs(
    source,
    program,
    inputUses,
    direct,
    exactCallImplementations,
    callableReferenceIsClosed,
    planningObserver,
    callableFields,
  );
  planningObserver?.("effect-indirect-value-inputs");
  const context: CallableOriginContext = {
    source,
    program,
    values,
    results,
    objectProjections,
    transports,
    builder: createEffectProvenanceGraphBuilder<IndirectInvocationBoundary>(),
    expressions: new Map(),
    declarations: new Map(),
    callableOrigins: new Set(),
  };
  const calls = new Map<Node, CallableOriginState>();
  for (const call of program.nodesOfKind(KindCallExpression)) {
    if (resolveProjectInvocation(source, call) !== undefined) {
      continue;
    }
    const target = exactCallableTarget(
      source,
      source.ast.as.AsCallExpression(call)?.Expression,
    );
    if (target !== undefined) {
      calls.set(call, expressionState(target, context));
    }
  }
  planningObserver?.("effect-indirect-graph");
  const graph = context.builder.seal();
  const resolved = resolveEffectProvenance(graph);
  planningObserver?.("effect-indirect-resolution");
  const selections = selectClosedIndirectCallableOrigins(
    graph,
    resolved,
    calls,
    context.callableOrigins,
    (declaration) => callableOriginIsExact(source, program, declaration),
  );
  planningObserver?.("effect-indirect-origin-index");
  const result: ExactIndirectCallableInvocation[] = [];
  const callableReferences = new Set<Node>();
  const closedRoots: EffectProvenanceVertex[] = [];
  for (const selection of selections) {
    result.push(Object.freeze({
      call: selection.call,
      implementations: selection.implementations,
    }));
    closedRoots.push(selection.vertex);
  }
  collectClosedIndirectCallableReferences(
    closedRoots,
    graph,
    callableReferences,
  );
  return Object.freeze({
    invocations: Object.freeze(result),
    callableReferences: Object.freeze(callableReferences),
  });
}

function expressionState(
  expression: Node,
  context: CallableOriginContext,
): CallableOriginState {
  const root = transparentExpression(context.source, expression);
  const selected = root ?? expression;
  let state = context.expressions.get(selected);
  if (state === undefined) {
    state = newState("expression", selected, context);
    context.expressions.set(selected, state);
  }
  if (state.expanded) {
    return state;
  }
  state.expanded = true;
  if (root === undefined) {
    boundary(state, "open-expression", expression, context);
    return state;
  }
  expandExpression(state, root, context);
  return state;
}

function expandExpression(
  state: CallableOriginState,
  root: Node,
  context: CallableOriginContext,
): void {
  const { source } = context;
  if (
    source.ast.is.IsArrowFunction(root) ||
    source.ast.is.IsFunctionExpression(root)
  ) {
    origin(state, root, context);
    return;
  }
  const alternatives = sameValueAlternatives(source, root);
  if (alternatives === null) {
    boundary(state, "open-expression", root, context);
    return;
  }
  if (alternatives !== undefined) {
    for (const alternative of alternatives) {
      dependency(state, expressionState(alternative, context), root, context);
    }
    return;
  }
  const semantics = source.semantics.forNode(root);
  const type = semantics.types.expressionType(root);
  if (type !== undefined && semantics.types.isNullish(type)) {
    emptyOrigin(state, root, context);
    return;
  }
  if (source.ast.is.IsCallExpression(root)) {
    const transported = context.transports?.transportFor(root)
      ?.resultOriginExpressions;
    if (transported !== undefined) {
      if (transported.length === 0) {
        boundary(state, "open-expression", root, context);
      }
      for (const selected of transported) {
        dependency(state, expressionState(selected, context), root, context);
      }
      return;
    }
  }
  const objectProperty = context.objectProjections.projectionFor(root);
  if (objectProperty !== undefined) {
    if (objectProperty.initializers.length === 0) {
      boundary(state, "open-projection", root, context);
      return;
    }
    for (const initializer of objectProperty.initializers) {
      dependency(state, expressionState(initializer, context), root, context);
    }
    return;
  }
  const directReturn = context.results.sourceFor(root);
  const projectedReturn = directReturn === undefined
    ? context.results.resultFor(root)
    : undefined;
  const returnedExpressions = directReturn?.expressions ??
    projectedReturn?.expressions;
  if (returnedExpressions !== undefined) {
    if (
      returnedExpressions.length === 0 ||
      projectedReturn?.projectionConsumers !== undefined &&
        !context.values.projectionConsumersAreClosed(
          projectedReturn.projectionConsumers,
        )
    ) {
      boundary(state, "open-projection", root, context);
      return;
    }
    for (const expression of returnedExpressions) {
      if (expression === undefined) {
        boundary(state, "open-expression", root, context);
      } else {
        dependency(state, expressionState(expression, context), root, context);
      }
    }
    return;
  }
  const referenceNode = source.ast.is.IsPropertyAccessExpression(root)
    ? source.ast.name(root)
    : root;
  const reference = source.navigation.sourceReferenceFor(referenceNode);
  if (
    reference?.project === true &&
    callableOriginIsExact(source, context.program, reference.declaration)
  ) {
    origin(state, reference.declaration, context);
    return;
  }
  if (
    reference?.project !== true ||
    !context.values.isClosed(reference.declaration)
  ) {
    boundary(state, "open-binding", root, context);
    return;
  }
  dependency(
    state,
    declarationState(reference.declaration, context),
    root,
    context,
  );
}

function declarationState(
  declaration: Node,
  context: CallableOriginContext,
): CallableOriginState {
  let state = context.declarations.get(declaration);
  if (state === undefined) {
    state = newState("binding", declaration, context);
    context.declarations.set(declaration, state);
  }
  if (state.expanded) {
    return state;
  }
  state.expanded = true;
  const inputs = context.values.valuesFor(declaration);
  if (inputs === undefined) {
    boundary(state, "open-binding", declaration, context);
  } else if (inputs.length === 0) {
    emptyOrigin(state, declaration, context);
  } else {
    for (const input of inputs) {
      dependency(state, expressionState(input, context), declaration, context);
    }
  }
  return state;
}

function callableOriginIsExact(
  source: TargetSourceProgram,
  program: TargetProgramIndex,
  declaration: Node,
): boolean {
  const callable = source.ast.is.IsFunctionDeclaration(declaration) ||
    source.ast.is.IsMethodDeclaration(declaration) ||
    source.ast.is.IsFunctionExpression(declaration) ||
    source.ast.is.IsArrowFunction(declaration);
  const sourceFile = source.ast.getSourceFile(declaration);
  return callable &&
    sourceFile !== undefined &&
    source.semantics.includes(sourceFile) &&
    source.ast.body(declaration) !== undefined &&
    !program.hasBindingWrite(declaration) &&
    callableDispatchIsClosed(source, program, declaration);
}

function newState(
  kind: "binding" | "expression",
  occurrence: Node,
  context: CallableOriginContext,
): CallableOriginState {
  return {
    vertex: context.builder.vertex(kind, occurrence),
    expanded: false,
  };
}

function dependency(
  destination: CallableOriginState,
  source: CallableOriginState,
  occurrence: Node,
  context: CallableOriginContext,
): void {
  context.builder.addDependency(
    destination.vertex,
    source.vertex,
    "alias",
    occurrence,
  );
}

function origin(
  state: CallableOriginState,
  occurrence: Node,
  context: CallableOriginContext,
): void {
  context.callableOrigins.add(occurrence);
  context.builder.addOrigin(state.vertex, occurrence);
}

function emptyOrigin(
  state: CallableOriginState,
  occurrence: Node,
  context: CallableOriginContext,
): void {
  context.builder.addOrigin(state.vertex, occurrence);
}

function boundary(
  state: CallableOriginState,
  reason: IndirectInvocationBoundary,
  occurrence: Node,
  context: CallableOriginContext,
): void {
  context.builder.addBoundary(state.vertex, reason, occurrence);
}
