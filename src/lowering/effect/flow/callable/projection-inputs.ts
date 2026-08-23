import type { Node } from "@tsonic/tsts";
import type { TargetSourceProgram } from "@tsonic/target-api/source";
import { KindCallExpression } from "@tsonic/tsts/target-ast";

import type { TargetProgramIndex } from "../../../program-index.js";
import type { TypeScriptPlanningObserver } from "../../../planning-observer.js";
import type { ExactAggregateProjectionIndex } from "../aggregate/projection.js";
import { createExactValueSlotFlow } from "../value/slot/flow.js";
import type {
  ExactValueSlotStep,
} from "../value/slot/model.js";
import {
  callableProjectedResultSlotReturnRewrites,
  type CallableReturnRewrite,
} from "../../model/callable-contract.js";
import { resolveProjectInvocation } from "../../model/project-invocation.js";
import { transparentExpression } from "../../model/syntax.js";
import type { CallableResultLookup } from "./result-inputs.js";
import type { ExactInvocationInputIndex } from "../invocation/inputs.js";
import { exactValueSlotPathKey } from "../value/slot/selectors.js";
import type { ClosedStorageOwnerAnalysis } from "../storage/analysis.js";
import type { ExactCallImplementations } from "./result-inputs.js";
import type { StorageOwnerBoundaryDependencies } from "../storage/owner-boundaries.js";

export interface CallableProjectionInput {
  readonly declaration: Node;
  readonly expressions: readonly Node[];
  readonly returnTypes: readonly CallableReturnRewrite[];
  readonly steps: readonly ExactValueSlotStep[];
  readonly projectionConsumers?: readonly Node[];
}

export interface CallableProjectionInputs {
  resultFor(expression: Node): CallableProjectionInput | undefined;
  outputsFor(reference: Node): readonly Node[] | undefined;
}

export function createCallableProjectionInputs(
  source: TargetSourceProgram,
  program: TargetProgramIndex,
  projections: ExactAggregateProjectionIndex,
  results: CallableResultLookup,
  exactCallContracts: ((call: Node) => readonly Node[] | undefined) | undefined,
  invocationInputs: ExactInvocationInputIndex | undefined,
  candidates: readonly Node[],
  planningObserver?: TypeScriptPlanningObserver,
  storageOwners?: ClosedStorageOwnerAnalysis,
  exactCallImplementations?: ExactCallImplementations,
  callableReferenceIsClosed?: (reference: Node) => boolean,
  boundaryDependencies?: StorageOwnerBoundaryDependencies,
): CallableProjectionInputs {
  const slots = createExactValueSlotFlow(
    source,
    program,
    projections,
    (call) => results.sourceFor(call),
    invocationInputs,
    candidates,
    planningObserver,
    storageOwners,
    exactCallImplementations,
    callableReferenceIsClosed,
    boundaryDependencies,
  );
  const projectionResults = new Map<Node, CallableProjectionInput>();
  for (const expression of candidates) {
    const slot = slots.resultFor(expression);
    if (slot?.closed !== true) {
      continue;
    }
    const returnTypes = projectionReturnTypes(source, slot.steps);
    if (returnTypes === undefined) {
      continue;
    }
    projectionResults.set(expression, Object.freeze({
      declaration: expression,
      expressions: slot.expressions,
      returnTypes,
      steps: slot.steps,
    }));
  }
  const callsByDeclaration = indexCallsByDeclaration(
    source,
    program,
    exactCallContracts,
  );
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
  const sealedOutputs = new Map<Node, readonly Node[]>(
    [...outputsByExpression].map(([expression, outputs]) => [
      expression,
      Object.freeze([...outputs]),
    ]),
  );
  planningObserver?.("effect-callable-projections");
  return Object.freeze({
    resultFor(expression: Node): CallableProjectionInput | undefined {
      const root = transparentExpression(source, expression);
      return root === undefined ? undefined : finalizedResults.get(root);
    },
    outputsFor(reference: Node): readonly Node[] | undefined {
      return projectionOutputsFor(source, sealedOutputs, reference);
    },
  });
}

function projectionReturnTypes(
  source: TargetSourceProgram,
  steps: readonly ExactValueSlotStep[],
): readonly CallableReturnRewrite[] | undefined {
  const rewrites = new Map<Node, CallableReturnRewrite>();
  for (const step of steps) {
    for (const declaration of step.contracts) {
      const selected = callableProjectedResultSlotReturnRewrites(
        source,
        declaration,
        step.path,
      );
      if (selected === undefined) {
        return undefined;
      }
      for (const rewrite of selected) {
        const existing = rewrites.get(rewrite.target);
        if (
          existing !== undefined &&
          (
            existing.selection.kind !== rewrite.selection.kind ||
            existing.selection.index !== rewrite.selection.index
          )
        ) {
          return undefined;
        }
        rewrites.set(rewrite.target, rewrite);
      }
    }
  }
  return Object.freeze([...rewrites.values()]);
}

function indexCallsByDeclaration(
  source: TargetSourceProgram,
  program: TargetProgramIndex,
  exactCallContracts: ((call: Node) => readonly Node[] | undefined) | undefined,
): ReadonlyMap<Node, ReadonlySet<Node>> {
  const result = new Map<Node, Set<Node>>();
  for (const call of program.nodesOfKind(KindCallExpression)) {
    const direct = resolveProjectInvocation(source, call)?.implementation;
    const declarations = direct === undefined
      ? exactCallContracts?.(call) ?? []
      : [direct];
    for (const declaration of declarations) {
      appendSet(result, declaration, call);
    }
  }
  return result;
}

function indexTraversedProjectionCalls(
  projections: Iterable<CallableProjectionInput>,
): ReadonlyMap<Node, ReadonlyMap<string, ReadonlySet<Node>>> {
  const result = new Map<Node, Map<string, Set<Node>>>();
  for (const projection of projections) {
    for (const step of projection.steps) {
      const key = exactValueSlotPathKey(step.path);
      for (const declaration of step.contracts) {
        let byPath = result.get(declaration);
        if (byPath === undefined) {
          byPath = new Map();
          result.set(declaration, byPath);
        }
        let calls = byPath.get(key);
        if (calls === undefined) {
          calls = new Set();
          byPath.set(key, calls);
        }
        calls.add(step.invocation);
      }
    }
  }
  return result;
}

function indexCompleteProjectionSteps(
  callsByDeclaration: ReadonlyMap<Node, ReadonlySet<Node>>,
  traversed: ReadonlyMap<Node, ReadonlyMap<string, ReadonlySet<Node>>>,
): ReadonlyMap<Node, ReadonlySet<string>> {
  const result = new Map<Node, Set<string>>();
  for (const [declaration, byPath] of traversed) {
    const allCalls = callsByDeclaration.get(declaration) ?? new Set<Node>();
    for (const [path, selected] of byPath) {
      if (
        selected.size !== allCalls.size ||
        [...allCalls].some((call) => !selected.has(call))
      ) {
        continue;
      }
      const paths = result.get(declaration);
      if (paths === undefined) {
        result.set(declaration, new Set([path]));
      } else {
        paths.add(path);
      }
    }
  }
  return result;
}

function projectionPathIsComplete(
  steps: readonly ExactValueSlotStep[],
  complete: ReadonlyMap<Node, ReadonlySet<string>>,
): boolean {
  return steps.every((step) => {
    const path = exactValueSlotPathKey(step.path);
    return step.contracts.every((declaration) =>
      complete.get(declaration)?.has(path) === true
    );
  });
}

function projectionOutputsFor(
  source: TargetSourceProgram,
  outputs: ReadonlyMap<Node, readonly Node[]>,
  reference: Node,
): readonly Node[] | undefined {
  let current = reference;
  for (;;) {
    const selected = outputs.get(current);
    if (selected !== undefined) {
      return selected;
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
}

function appendSet<K>(target: Map<K, Set<Node>>, key: K, value: Node): void {
  const values = target.get(key);
  if (values === undefined) {
    target.set(key, new Set([value]));
  } else {
    values.add(value);
  }
}
