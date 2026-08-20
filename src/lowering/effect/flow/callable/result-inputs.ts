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
  transparentExpression,
} from "../../model/syntax.js";
import { resolveProjectInvocation } from "../../model/project-invocation.js";
import { createCallableProjectionInputs } from "./projection-inputs.js";
import { exactCallableReturnExpressions } from "../invocation/results.js";
import type { ExactInvocationInputIndex } from "../invocation/inputs.js";

export interface CallableResultInput {
  readonly expressions: readonly (Node | undefined)[];
  readonly returnTypes: readonly CallableReturnRewrite[];
  readonly projectionConsumers?: readonly Node[];
}

export interface CallableResultSourceInput {
  readonly declaration: Node;
  readonly contracts: readonly Node[];
  readonly expressions: readonly (Node | undefined)[];
}

export interface CallableResultLookup {
  sourceFor(expression: Node): CallableResultSourceInput | undefined;
  resultFor(expression: Node): CallableResultInput | undefined;
}

export interface CallableResultInputs extends CallableResultLookup {
  projectionOutputsFor(reference: Node): readonly Node[] | undefined;
}

export type ExactCallImplementations = (
  call: Node,
) => readonly Node[] | undefined;

interface SelectedCallSource {
  readonly declaration: Node;
  readonly contracts: readonly Node[];
  readonly implementations: readonly Node[];
}

export function createCallableResultInputs(
  source: TargetSourceProgram,
  program: TargetProgramIndex,
  projections: ExactAggregateProjectionIndex,
  candidates: ReadonlySet<Node>,
  exactCallImplementations?: ExactCallImplementations,
  invocationInputs?: ExactInvocationInputIndex,
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
    const selectedSource = selectedCallSource(
      source,
      selected.call,
      exactCallImplementations,
    );
    if (selectedSource === undefined) {
      sources.set(expression, null);
      return undefined;
    }
    const expressions: (Node | undefined)[] = [];
    for (const implementation of selectedSource.implementations) {
      const returned = inspectedReturns(
        source,
        program,
        candidates,
        selected.awaited,
        implementation,
        returns,
      );
      if (returned === undefined) {
        sources.set(expression, null);
        return undefined;
      }
      expressions.push(...returned);
    }
    const result = Object.freeze({
      declaration: selectedSource.declaration,
      contracts: selectedSource.contracts,
      expressions: Object.freeze(expressions),
    });
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
      const selected = selectedCall(source, expression);
      if (selected === undefined) {
        results.set(expression, null);
        return undefined;
      }
      const selectedSource = selectedCallSource(
        source,
        selected.call,
        exactCallImplementations,
      );
      if (selectedSource === undefined) {
        results.set(expression, null);
        return undefined;
      }
      const expressions: (Node | undefined)[] = [];
      const rewrites: CallableReturnRewrite[] = [];
      for (const declaration of selectedSource.implementations) {
        const selectedReturns = inspectedReturns(
          source,
          program,
          candidates,
          selected.awaited,
          declaration,
          returns,
        );
        if (selectedReturns === undefined) {
          results.set(expression, null);
          return undefined;
        }
        expressions.push(...selectedReturns);
      }
      for (const declaration of selectedSource.contracts) {
        const selectedRewrites = cachedReturnRewrites(
          source,
          declaration,
          returnTypes,
        );
        if (selectedRewrites === undefined) {
          results.set(expression, null);
          return undefined;
        }
        rewrites.push(...selectedRewrites);
      }
      const result = Object.freeze({
        expressions: Object.freeze(expressions),
        returnTypes: Object.freeze(rewrites),
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
    (call) => selectedCallSource(
      source,
      call,
      exactCallImplementations,
    )?.contracts,
    invocationInputs,
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

function selectedCallSource(
  source: TargetSourceProgram,
  call: Node,
  exactCallImplementations: ExactCallImplementations | undefined,
): SelectedCallSource | undefined {
  const direct = resolveProjectInvocation(source, call)?.implementation;
  if (direct !== undefined) {
    return Object.freeze({
      declaration: direct,
      contracts: Object.freeze([direct]),
      implementations: Object.freeze([direct]),
    });
  }
  const implementations = Object.freeze([
    ...new Set(exactCallImplementations?.(call) ?? []),
  ]);
  const semantics = source.semantics.forNode(call);
  const contract = semantics.getSignatureDeclaration(
    semantics.getResolvedSignature(call),
  );
  return contract === undefined || implementations.length === 0
    ? undefined
    : Object.freeze({
        declaration: contract,
        contracts: Object.freeze([
          contract,
          ...implementations.filter((value) => value !== contract),
        ]),
        implementations,
      });
}

function inspectedReturns(
  source: TargetSourceProgram,
  program: TargetProgramIndex,
  candidates: ReadonlySet<Node>,
  awaited: boolean,
  declaration: Node,
  cache: Map<Node, readonly (Node | undefined)[] | null>,
): readonly (Node | undefined)[] | undefined {
  if (
    !source.navigation.isProjectDeclaration(declaration) ||
    !callableDispatchIsClosed(source, program, declaration) ||
    program.hasBindingWrite(declaration) ||
    (source.ast.hasModifierKind(declaration, "async") &&
      !awaited &&
      !candidates.has(declaration))
  ) {
    return undefined;
  }
  let expressions = cache.get(declaration);
  if (expressions === undefined) {
    expressions = exactCallableReturnExpressions(source, declaration) ?? null;
    cache.set(declaration, expressions);
  }
  return expressions ?? undefined;
}

function cachedReturnRewrites(
  source: TargetSourceProgram,
  declaration: Node,
  cache: Map<Node, readonly CallableReturnRewrite[] | null>,
): readonly CallableReturnRewrite[] | undefined {
  let rewrites = cache.get(declaration);
  if (rewrites === undefined) {
    rewrites = callableResultReturnRewrites(source, declaration) ?? null;
    cache.set(declaration, rewrites);
  }
  return rewrites ?? undefined;
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
