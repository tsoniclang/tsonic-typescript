import type { Node } from "@tsonic/tsts";
import type { TargetSourceProgram } from "@tsonic/target-api";
import {
  KindCallExpression,
  KindElementAccessExpression,
} from "@tsonic/tsts/target-ast";

import type { TargetProgramIndex } from "../../../program-index.js";
import type { ExactAggregateProjectionIndex } from "../aggregate/projection.js";
import {
  callableProjectedResultReturnRewrites,
  type CallableReturnRewrite,
} from "../../model/callable-contract.js";
import { resolveProjectInvocation } from "../../model/project-invocation.js";
import { transparentExpression } from "../../model/syntax.js";
import type { CallableResultLookup } from "./result-inputs.js";

export interface CallableProjectionInput {
  readonly declaration: Node;
  readonly expressions: readonly Node[];
  readonly returnTypes: readonly CallableReturnRewrite[];
  readonly steps: readonly ProjectionStep[];
  readonly projectionConsumers?: readonly Node[];
}

export interface CallableProjectionInputs {
  resultFor(expression: Node): CallableProjectionInput | undefined;
  outputsFor(reference: Node): readonly Node[] | undefined;
}

interface MutableProjectionInput {
  readonly expressions: Node[];
  readonly returnTypes: Map<Node, CallableReturnRewrite>;
  readonly steps: Map<Node, Map<number, Set<Node>>>;
}

interface ProjectionStep {
  readonly declaration: Node;
  readonly invocation: Node;
  readonly index: number;
}

export function createCallableProjectionInputs(
  source: TargetSourceProgram,
  program: TargetProgramIndex,
  projections: ExactAggregateProjectionIndex,
  results: CallableResultLookup,
): CallableProjectionInputs {
  const cached = new Map<Node, Map<number, CallableProjectionInput | null>>();
  const pending = new Map<Node, Set<number>>();
  const rawResultFor = (expression: Node): CallableProjectionInput | undefined => {
    const projection = projections.projectionFor(expression);
    if (projection === undefined) {
      return undefined;
    }
    const resolved = collectProjectedSlot(
      source,
      projection.source.initializer,
      projection.index,
      projections,
      results,
      cached,
      pending,
    );
    return resolved === undefined
      ? undefined
      : sealProjectionInput(resolved, expression);
  };
  const projectionResults = new Map<Node, CallableProjectionInput>();
  for (const expression of program.nodesOfKind(KindElementAccessExpression)) {
    const result = rawResultFor(expression);
    if (result !== undefined) {
      projectionResults.set(expression, result);
    }
  }
  const callsByDeclaration = indexCallsByDeclaration(source, program);
  const traversed = indexTraversedProjectionCalls(projectionResults.values());
  const completeSteps = indexCompleteProjectionSteps(
    callsByDeclaration,
    traversed,
  );
  const outputsByExpression = new Map<Node, Set<Node>>();
  const completeResults = new Map<Node, CallableProjectionInput>();
  for (const [output, result] of projectionResults) {
    if (!projectionPathIsComplete(result.steps, completeSteps)) {
      continue;
    }
    completeResults.set(output, result);
    for (const expression of result.expressions) {
      appendSet(outputsByExpression, expression, output);
    }
  }
  const finalizedResults = new Map<Node, CallableProjectionInput>();
  for (const [output, result] of completeResults) {
    const consumers = new Set<Node>();
    for (const expression of result.expressions) {
      for (const consumer of outputsByExpression.get(expression) ?? []) {
        consumers.add(consumer);
      }
    }
    finalizedResults.set(output, Object.freeze({
      ...result,
      projectionConsumers: Object.freeze([...consumers]),
    }));
  }
  const sealedOutputsByExpression = new Map<Node, readonly Node[]>(
    [...outputsByExpression].map(([expression, outputs]) => [
      expression,
      Object.freeze([...outputs]),
    ]),
  );
  return Object.freeze({
    resultFor(expression: Node): CallableProjectionInput | undefined {
      const root = transparentExpression(source, expression);
      return root === undefined ? undefined : finalizedResults.get(root);
    },
    outputsFor(reference: Node): readonly Node[] | undefined {
      let current = reference;
      for (;;) {
        const outputs = sealedOutputsByExpression.get(current);
        if (outputs !== undefined) {
          return outputs;
        }
        const parent = source.ast.parent(current);
        if (
          parent === undefined ||
          transparentExpression(source, parent) !== current
        ) {
          return undefined;
        }
        current = parent;
      }
    },
  });
}

function collectProjectedSlot(
  source: TargetSourceProgram,
  expression: Node,
  index: number,
  projections: ExactAggregateProjectionIndex,
  results: CallableResultLookup,
  cached: Map<Node, Map<number, CallableProjectionInput | null>>,
  pending: Map<Node, Set<number>>,
): MutableProjectionInput | undefined {
  const root = transparentExpression(source, expression);
  if (root === undefined) {
    return undefined;
  }
  if (source.ast.is.IsConditionalExpression(root)) {
    const conditional = source.ast.as.AsConditionalExpression(root);
    return mergeBranches(
      source,
      [conditional?.WhenTrue, conditional?.WhenFalse],
      index,
      projections,
      results,
      cached,
      pending,
    );
  }
  const aggregate = source.ast.is.IsAwaitExpression(root)
    ? transparentExpression(
        source,
        source.ast.as.AsAwaitExpression(root)?.Expression,
      )
    : root;
  if (aggregate === undefined) {
    return undefined;
  }
  if (source.ast.is.IsArrayLiteralExpression(aggregate)) {
    const selected = source.ast.elements(aggregate)[index];
    return selected === undefined || source.ast.is.IsSpreadElement(selected)
      ? undefined
      : { expressions: [selected], returnTypes: new Map(), steps: new Map() };
  }
  if (source.ast.is.IsCallExpression(aggregate)) {
    return collectCallSlot(
      source,
      root,
      index,
      projections,
      results,
      cached,
      pending,
    );
  }
  if (source.ast.is.IsIdentifier(aggregate)) {
    const sourceBinding = projections.sourceForReference(aggregate);
    return sourceBinding === undefined
      ? undefined
      : collectProjectedSlot(
          source,
          sourceBinding.initializer,
          index,
          projections,
          results,
          cached,
          pending,
        );
  }
  return undefined;
}

function collectCallSlot(
  source: TargetSourceProgram,
  expression: Node,
  index: number,
  projections: ExactAggregateProjectionIndex,
  results: CallableResultLookup,
  cached: Map<Node, Map<number, CallableProjectionInput | null>>,
  pending: Map<Node, Set<number>>,
): MutableProjectionInput | undefined {
  const input = results.sourceFor(expression);
  if (input === undefined) {
    return undefined;
  }
  const existing = cached.get(input.declaration)?.get(index);
  if (existing !== undefined) {
    if (existing === null) {
      return undefined;
    }
    const result = mutableProjectionInput(existing);
    appendStep(
      result.steps,
      input.declaration,
      index,
      selectedInvocation(source, expression),
    );
    return result;
  }
  const declarationPending = pending.get(input.declaration);
  if (declarationPending?.has(index) === true) {
    return undefined;
  }
  if (declarationPending === undefined) {
    pending.set(input.declaration, new Set([index]));
  } else {
    declarationPending.add(index);
  }
  const rewrites = callableProjectedResultReturnRewrites(
    source,
    input.declaration,
    index,
  );
  const resolved = rewrites === undefined
    ? undefined
    : mergeBranches(
        source,
        input.expressions,
        index,
        projections,
        results,
        cached,
        pending,
      );
  pending.get(input.declaration)?.delete(index);
  if (resolved !== undefined) {
    for (const rewrite of rewrites ?? []) {
      if (!mergeReturnType(resolved.returnTypes, rewrite)) {
        cacheProjection(cached, input.declaration, index, null);
        return undefined;
      }
    }
  }
  const sealed = resolved === undefined
    ? null
    : sealProjectionInput(resolved, input.declaration);
  cacheProjection(cached, input.declaration, index, sealed);
  if (sealed === null) {
    return undefined;
  }
  const result = mutableProjectionInput(sealed);
  appendStep(
    result.steps,
    input.declaration,
    index,
    selectedInvocation(source, expression),
  );
  return result;
}

function mergeBranches(
  source: TargetSourceProgram,
  branches: readonly (Node | undefined)[],
  index: number,
  projections: ExactAggregateProjectionIndex,
  results: CallableResultLookup,
  cached: Map<Node, Map<number, CallableProjectionInput | null>>,
  pending: Map<Node, Set<number>>,
): MutableProjectionInput | undefined {
  if (branches.length === 0 || branches.some((branch) => branch === undefined)) {
    return undefined;
  }
  const merged: MutableProjectionInput = {
    expressions: [],
    returnTypes: new Map(),
    steps: new Map(),
  };
  for (const branch of branches) {
    if (branch === undefined) {
      return undefined;
    }
    const selected = collectProjectedSlot(
      source,
      branch,
      index,
      projections,
      results,
      cached,
      pending,
    );
    if (selected === undefined) {
      return undefined;
    }
    merged.expressions.push(...selected.expressions);
    mergeSteps(merged.steps, selected.steps);
    for (const rewrite of selected.returnTypes.values()) {
      if (!mergeReturnType(merged.returnTypes, rewrite)) {
        return undefined;
      }
    }
  }
  return merged;
}

function mergeReturnType(
  target: Map<Node, CallableReturnRewrite>,
  rewrite: CallableReturnRewrite,
): boolean {
  const existing = target.get(rewrite.target);
  if (existing === undefined) {
    target.set(rewrite.target, rewrite);
    return true;
  }
  return existing.selection.kind === rewrite.selection.kind &&
    existing.selection.index === rewrite.selection.index;
}

function sealProjectionInput(
  input: MutableProjectionInput,
  declaration: Node,
): CallableProjectionInput {
  return Object.freeze({
    declaration,
    expressions: Object.freeze([...input.expressions]),
    returnTypes: Object.freeze([...input.returnTypes.values()]),
    steps: Object.freeze(flattenSteps(input.steps)),
  });
}

function mutableProjectionInput(
  input: CallableProjectionInput,
): MutableProjectionInput {
  return {
    expressions: [...input.expressions],
    returnTypes: new Map(input.returnTypes.map((rewrite) => [
      rewrite.target,
      rewrite,
    ])),
    steps: mutableSteps(input.steps),
  };
}

function selectedInvocation(source: TargetSourceProgram, expression: Node): Node {
  const root = transparentExpression(source, expression);
  const invocation = root !== undefined && source.ast.is.IsAwaitExpression(root)
    ? transparentExpression(
      source,
      source.ast.as.AsAwaitExpression(root)?.Expression,
    )
    : root;
  if (invocation === undefined || !source.ast.is.IsCallExpression(invocation)) {
    throw new Error("callable projection source lost its exact invocation");
  }
  return invocation;
}

function indexCallsByDeclaration(
  source: TargetSourceProgram,
  program: TargetProgramIndex,
): ReadonlyMap<Node, ReadonlySet<Node>> {
  const result = new Map<Node, Set<Node>>();
  for (const call of program.nodesOfKind(KindCallExpression)) {
    const declaration = resolveProjectInvocation(source, call)?.implementation;
    if (declaration !== undefined) {
      appendSet(result, declaration, call);
    }
  }
  return result;
}

function indexTraversedProjectionCalls(
  projections: Iterable<CallableProjectionInput>,
): ReadonlyMap<Node, ReadonlyMap<number, ReadonlySet<Node>>> {
  const result = new Map<Node, Map<number, Set<Node>>>();
  for (const projection of projections) {
    for (const step of projection.steps) {
      let byIndex = result.get(step.declaration);
      if (byIndex === undefined) {
        byIndex = new Map();
        result.set(step.declaration, byIndex);
      }
      let calls = byIndex.get(step.index);
      if (calls === undefined) {
        calls = new Set();
        byIndex.set(step.index, calls);
      }
      calls.add(step.invocation);
    }
  }
  return result;
}

function indexCompleteProjectionSteps(
  callsByDeclaration: ReadonlyMap<Node, ReadonlySet<Node>>,
  traversed: ReadonlyMap<Node, ReadonlyMap<number, ReadonlySet<Node>>>,
): ReadonlyMap<Node, ReadonlySet<number>> {
  const result = new Map<Node, Set<number>>();
  for (const [declaration, byIndex] of traversed) {
    const allCalls = callsByDeclaration.get(declaration) ?? new Set<Node>();
    for (const [index, selected] of byIndex) {
      if (
        selected.size === allCalls.size &&
        [...allCalls].every((call) => selected.has(call))
      ) {
        let indices = result.get(declaration);
        if (indices === undefined) {
          indices = new Set();
          result.set(declaration, indices);
        }
        indices.add(index);
      }
    }
  }
  return result;
}

function projectionPathIsComplete(
  steps: readonly ProjectionStep[],
  complete: ReadonlyMap<Node, ReadonlySet<number>>,
): boolean {
  for (const step of steps) {
    if (complete.get(step.declaration)?.has(step.index) !== true) {
      return false;
    }
  }
  return true;
}

function appendStep(
  target: Map<Node, Map<number, Set<Node>>>,
  declaration: Node,
  index: number,
  invocation: Node,
): void {
  let byIndex = target.get(declaration);
  if (byIndex === undefined) {
    byIndex = new Map();
    target.set(declaration, byIndex);
  }
  let calls = byIndex.get(index);
  if (calls === undefined) {
    calls = new Set();
    byIndex.set(index, calls);
  }
  calls.add(invocation);
}

function mergeSteps(
  target: Map<Node, Map<number, Set<Node>>>,
  source: ReadonlyMap<Node, ReadonlyMap<number, ReadonlySet<Node>>>,
): void {
  for (const [declaration, byIndex] of source) {
    for (const [index, calls] of byIndex) {
      for (const call of calls) {
        appendStep(target, declaration, index, call);
      }
    }
  }
}

function flattenSteps(
  steps: ReadonlyMap<Node, ReadonlyMap<number, ReadonlySet<Node>>>,
): ProjectionStep[] {
  const result: ProjectionStep[] = [];
  for (const [declaration, byIndex] of steps) {
    for (const [index, calls] of byIndex) {
      for (const invocation of calls) {
        result.push({ declaration, invocation, index });
      }
    }
  }
  return result;
}

function mutableSteps(
  steps: readonly ProjectionStep[],
): Map<Node, Map<number, Set<Node>>> {
  const result = new Map<Node, Map<number, Set<Node>>>();
  for (const step of steps) {
    appendStep(result, step.declaration, step.index, step.invocation);
  }
  return result;
}

function appendSet<K>(target: Map<K, Set<Node>>, key: K, value: Node): void {
  const values = target.get(key);
  if (values === undefined) {
    target.set(key, new Set([value]));
  } else {
    values.add(value);
  }
}

function cacheProjection(
  cache: Map<Node, Map<number, CallableProjectionInput | null>>,
  declaration: Node,
  index: number,
  input: CallableProjectionInput | null,
): void {
  const entries = cache.get(declaration);
  if (entries === undefined) {
    cache.set(declaration, new Map([[index, input]]));
  } else {
    entries.set(index, input);
  }
}
