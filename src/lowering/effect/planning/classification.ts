import type { Node, Symbol } from "@tsonic/tsts";
import type { TargetSourceProgram } from "@tsonic/target-api/source";
import {
  KindAwaitExpression,
  KindIdentifier,
  KindReturnStatement,
} from "@tsonic/tsts/target-ast";

import type { TargetProgramIndex } from "../../program-index.js";
import type { CooperativeEffectCandidate } from "../inventory/candidates.js";
import { blockCooperativeEffect } from "../closure/retention.js";
import type { DeclaredInterfaceDispatch } from "../flow/interface/dispatch.js";
import type { ReturnValueFlow } from "../flow/return/value.js";
import {
  containingAwait,
  containingReturn,
  directContainingCall,
  exactCallExpression,
  isFunctionLike,
  isDiscardedCall,
  isModuleForwardingReference,
} from "../model/syntax.js";
import type { CallableValueFlow } from "../flow/callable/value-flow.js";
import { isCallableNonEscapingObservation } from "../flow/callable/input-reference.js";
import { connectCooperativeEffectDependency } from "../closure/dependency.js";
import { classifyReturnedExpression } from "./classification/returned-expression.js";

const noDependencies: readonly Node[] = Object.freeze([]);

export function classifyCooperativeEffectProgram(
  source: TargetSourceProgram,
  program: TargetProgramIndex,
  candidates: ReadonlyMap<Node, CooperativeEffectCandidate>,
  calls: ReadonlyMap<Node, CooperativeEffectCandidate>,
  interfaces: DeclaredInterfaceDispatch,
  valueFlow: CallableValueFlow,
  returnFlow: ReturnValueFlow,
  conditionalSettlements: (dependencies: Iterable<Node>) =>
    ReadonlySet<Node> | undefined,
): void {
  const tracked = indexCandidateSymbols(source, candidates.values());
  for (const node of program.nodesOfKind(KindAwaitExpression)) {
    classifyAwaitDependencies(
      source,
      candidates,
      calls,
      interfaces,
      valueFlow,
      returnFlow,
      conditionalSettlements,
      node,
    );
  }
  for (const node of program.nodesOfKind(KindReturnStatement)) {
    classifyReturnDependencies(
      source,
      candidates,
      calls,
      interfaces,
      valueFlow,
      returnFlow,
      conditionalSettlements,
      node,
    );
  }
  for (const candidate of candidates.values()) {
    const body = source.ast.is.IsArrowFunction(candidate.declaration)
      ? source.ast.body(candidate.declaration)
      : undefined;
    if (body !== undefined && !source.ast.is.IsBlock(body)) {
      classifyReturnedExpression(
        source,
        candidates,
        calls,
        interfaces,
        valueFlow,
        returnFlow,
        conditionalSettlements,
        candidate,
        body,
      );
    }
  }
  for (const node of program.nodesOfKind(KindIdentifier)) {
    const candidate = candidateForReference(source, tracked, node);
    if (
      candidate === undefined ||
      node === source.ast.name(candidate.declaration) ||
      isModuleForwardingReference(source, node) ||
      isCallableNonEscapingObservation(source, node) ||
      valueFlow.allowsCallableReference(node)
    ) {
      continue;
    }
    const call = directContainingCall(source, node);
    if (call === undefined || calls.get(call) !== candidate) {
      blockCooperativeEffect(candidate, "escaping-callable", node);
    }
  }
  for (const candidate of candidates.values()) {
    if (
      (source.ast.is.IsArrowFunction(candidate.declaration) ||
        source.ast.is.IsFunctionExpression(candidate.declaration)) &&
      !valueFlow.allowsCallableReference(candidate.declaration) &&
      directContainingCall(source, candidate.declaration) === undefined
    ) {
      blockCooperativeEffect(
        candidate,
        "escaping-callable",
        candidate.declaration,
      );
    }
  }
}

export function classifyCooperativeEffectCallUses(
  source: TargetSourceProgram,
  candidates: ReadonlyMap<Node, CooperativeEffectCandidate>,
  calls: ReadonlyMap<Node, CooperativeEffectCandidate>,
  interfaces: DeclaredInterfaceDispatch,
  valueFlow: CallableValueFlow,
  returnedCallHasClosedConsumers: (call: Node) => boolean,
): void {
  for (const [call, candidate] of calls) {
    const use = cooperativeCallUse(source, candidates, call);
    if (use === "awaited") {
      continue;
    }
    if (use === "discarded") {
      blockCooperativeEffect(candidate, "promise-observed", call);
      continue;
    }
    if (typeof use !== "string") {
      connectCooperativeEffectDependency(use.owner, candidate, "return", call);
      continue;
    }
    if (returnedCallHasClosedConsumers(call)) {
      continue;
    }
    blockCooperativeEffect(candidate, "promise-observed", call);
  }
  for (const [call, family] of interfaces.calls) {
    const use = cooperativeCallUse(source, candidates, call);
    if (use === "awaited") {
      continue;
    }
    if (use === "discarded") {
      interfaces.block(family, "promise-observed", call);
      continue;
    }
    if (typeof use !== "string") {
      interfaces.addDependencies(use.owner, family, "return", call);
      continue;
    }
    if (returnedCallHasClosedConsumers(call)) {
      continue;
    }
    interfaces.block(family, "promise-observed", call);
  }
  valueFlow.forEachCall((call, resolution) => {
    if (
      calls.has(call) ||
      interfaces.calls.has(call) ||
      resolution.dependencyCount === 0
    ) {
      return;
    }
    const use = cooperativeCallUse(source, candidates, call);
    if (resolution.closed && use === "awaited") {
      return;
    }
    if (use === "discarded") {
      for (const declaration of resolution.dependencyNodes()) {
        const candidate = candidates.get(declaration);
        if (candidate !== undefined) {
          blockCooperativeEffect(candidate, "promise-observed", call);
        }
      }
      return;
    }
    if (resolution.closed && typeof use !== "string") {
      return;
    }
    if (resolution.closed && returnedCallHasClosedConsumers(call)) {
      return;
    }
    for (const declaration of resolution.dependencyNodes()) {
      const candidate = candidates.get(declaration);
      if (candidate !== undefined) {
        blockCooperativeEffect(candidate, "promise-observed", call);
      }
    }
  });
}

export function collectCooperativeResultConsumerQueries(
  source: TargetSourceProgram,
  candidates: ReadonlyMap<Node, CooperativeEffectCandidate>,
  calls: ReadonlyMap<Node, CooperativeEffectCandidate>,
  interfaces: DeclaredInterfaceDispatch,
  valueFlow: CallableValueFlow,
): ReadonlySet<Node> {
  const queries = new Set<Node>();
  const include = (call: Node): void => {
    if (cooperativeCallUse(source, candidates, call) === "consumer") {
      queries.add(call);
    }
  };
  for (const call of calls.keys()) {
    include(call);
  }
  for (const call of interfaces.calls.keys()) {
    include(call);
  }
  valueFlow.forEachCall((call, resolution) => {
    if (
      !calls.has(call) &&
      !interfaces.calls.has(call) &&
      resolution.closed &&
      resolution.dependencyCount !== 0
    ) {
      include(call);
    }
  });
  return Object.freeze(queries);
}

type CooperativeCallUse =
  | "awaited"
  | "discarded"
  | "consumer"
  | { readonly kind: "returned"; readonly owner: CooperativeEffectCandidate };

function cooperativeCallUse(
  source: TargetSourceProgram,
  candidates: ReadonlyMap<Node, CooperativeEffectCandidate>,
  call: Node,
): CooperativeCallUse {
  if (containingAwait(source, call) !== undefined) {
    return "awaited";
  }
  if (isDiscardedCall(source, call)) {
    return "discarded";
  }
  const owner = enclosingCandidate(source, candidates, call);
  return owner !== undefined && containingReturn(source, call) !== undefined
    ? Object.freeze({ kind: "returned", owner })
    : "consumer";
}

export function collectSettledCooperativeAwaits(
  source: TargetSourceProgram,
  program: TargetProgramIndex,
  candidates: ReadonlyMap<Node, CooperativeEffectCandidate>,
  calls: ReadonlyMap<Node, CooperativeEffectCandidate>,
  interfaces: DeclaredInterfaceDispatch,
  valueFlow: CallableValueFlow,
  returnFlow: ReturnValueFlow,
  optimized: ReadonlySet<Node>,
): ReadonlySet<Node> {
  const awaits = new Set<Node>();
  for (const node of program.nodesOfKind(KindAwaitExpression)) {
    const expression = source.ast.as.AsAwaitExpression(node)?.Expression;
    if (expression === undefined) {
      continue;
    }
    const call = exactCallExpression(
      source,
      expression,
    );
    if (call === undefined) {
      const returned = returnFlow.resolutionFor(expression);
      if (
        returned.closed &&
        !hasRetainedDependency(returned.dependencyNodes(), candidates, optimized)
      ) {
        awaits.add(node);
      }
      continue;
    }
    const direct = calls.get(call);
    const family = interfaces.calls.get(call);
    const resolution = direct === undefined
      ? valueFlow.resolutionFor(call)
      : undefined;
    const contract = direct === undefined && family === undefined
      ? valueFlow.contractForCall(call)
      : undefined;
    const dependencies: Iterable<Node> = direct === undefined
      ? resolution?.dependencyNodes() ?? noDependencies
      : [direct.declaration];
    if (
      (direct === undefined &&
        family === undefined &&
        (resolution === undefined || !resolution.closed ||
          contract === undefined || !contract.closed)) ||
      (family !== undefined && !interfaces.callIsSettled(call, optimized)) ||
      hasRetainedDependency(dependencies, candidates, optimized) ||
      (contract !== undefined && hasRetainedDependency(
        contract.dependencyNodes(),
        candidates,
        optimized,
      )) ||
      (direct === undefined &&
        family === undefined &&
        resolution !== undefined &&
        resolution.synchronousDeclarationCount !== 0 &&
        !returnFlow.callResultIsDefinitelyNonThenable(
          call,
          resolution.synchronousDeclarationNodes(),
          optimized,
        ))
    ) {
      continue;
    }
    awaits.add(node);
  }
  return awaits;
}

function classifyAwaitDependencies(
  source: TargetSourceProgram,
  candidates: ReadonlyMap<Node, CooperativeEffectCandidate>,
  calls: ReadonlyMap<Node, CooperativeEffectCandidate>,
  interfaces: DeclaredInterfaceDispatch,
  valueFlow: CallableValueFlow,
  returnFlow: ReturnValueFlow,
  conditionalSettlements: (dependencies: Iterable<Node>) =>
    ReadonlySet<Node> | undefined,
  node: Node,
): void {
  if (!source.ast.is.IsAwaitExpression(node)) {
    return;
  }
  const owner = enclosingCandidate(source, candidates, node);
  if (owner === undefined) {
    return;
  }
  const expression = source.ast.as.AsAwaitExpression(node)?.Expression;
  const call = exactCallExpression(source, expression);
  const dependency = call === undefined ? undefined : calls.get(call);
  if (call !== undefined && dependency !== undefined) {
    connectCooperativeEffectDependency(
      owner,
      dependency,
      "callable-invocation",
      call,
    );
    return;
  }
  const family = call === undefined ? undefined : interfaces.calls.get(call);
  if (call !== undefined && family !== undefined) {
    interfaces.addDependencies(
      owner,
      family,
      "callable-invocation",
      call,
    );
    return;
  }
  if (call === undefined) {
    const resolution = expression === undefined
      ? undefined
      : returnFlow.resolutionFor(expression);
    if (resolution === undefined || !resolution.closed) {
      blockCooperativeEffect(
        owner,
        "unresolved-call",
        expression ?? node,
      );
      return;
    }
    for (const declaration of resolution.dependencyNodes()) {
      const candidate = candidates.get(declaration);
      if (candidate === undefined) {
        blockCooperativeEffect(owner, "unresolved-call", expression ?? node);
        return;
      }
      connectCooperativeEffectDependency(
        owner,
        candidate,
        "result-consumption",
        expression ?? node,
      );
    }
    return;
  }
  const resolution = valueFlow.resolutionFor(call);
  if (resolution === undefined || !resolution.closed) {
    blockCooperativeEffect(
      owner,
      "unresolved-call",
      call ?? expression ?? node,
    );
    return;
  }
  const contract = valueFlow.contractForCall(call);
  if (contract === undefined || !contract.closed) {
    blockCooperativeEffect(owner, "unresolved-call", call);
    return;
  }
  for (const declaration of resolution.dependencyNodes()) {
    const candidate = candidates.get(declaration);
    if (candidate === undefined) {
      blockCooperativeEffect(owner, "unresolved-call", call);
      return;
    }
    connectCooperativeEffectDependency(
      owner,
      candidate,
      "callable-invocation",
      call,
    );
  }
  for (const declaration of contract.dependencyNodes()) {
    const candidate = candidates.get(declaration);
    if (candidate === undefined) {
      blockCooperativeEffect(owner, "unresolved-call", call);
      return;
    }
    connectCooperativeEffectDependency(
      owner,
      candidate,
      "callable-invocation",
      call,
    );
  }
  if (
    resolution.synchronousDeclarationCount !== 0 &&
    !returnFlow.callResultIsDefinitelyNonThenable(
      call,
      resolution.synchronousDeclarationNodes(),
      conditionalSettlements(resolution.dependencyNodes()),
    )
  ) {
    blockCooperativeEffect(owner, "promise-observed", call);
  }
}

function classifyReturnDependencies(
  source: TargetSourceProgram,
  candidates: ReadonlyMap<Node, CooperativeEffectCandidate>,
  calls: ReadonlyMap<Node, CooperativeEffectCandidate>,
  interfaces: DeclaredInterfaceDispatch,
  valueFlow: CallableValueFlow,
  returnFlow: ReturnValueFlow,
  conditionalSettlements: (dependencies: Iterable<Node>) =>
    ReadonlySet<Node> | undefined,
  node: Node,
): void {
  if (!source.ast.is.IsReturnStatement(node)) {
    return;
  }
  const owner = enclosingCandidate(source, candidates, node);
  if (owner === undefined) {
    return;
  }
  const expression = source.ast.as.AsReturnStatement(node)?.Expression;
  if (expression === undefined) {
    if (
      owner.innerType === undefined ||
      !source.semantics.forNode(node).types.isVoidLike(owner.innerType)
    ) {
      blockCooperativeEffect(owner, "incompatible-return", node);
    }
    return;
  }
  classifyReturnedExpression(
    source,
    candidates,
    calls,
    interfaces,
    valueFlow,
    returnFlow,
    conditionalSettlements,
    owner,
    expression,
  );
}

function indexCandidateSymbols(
  source: TargetSourceProgram,
  candidates: Iterable<CooperativeEffectCandidate>,
): ReadonlyMap<Symbol, CooperativeEffectCandidate> {
  const result = new Map<Symbol, CooperativeEffectCandidate>();
  for (const candidate of candidates) {
    const name = source.ast.name(candidate.declaration);
    for (const symbol of exactSymbolsAt(source, name)) {
      result.set(symbol, candidate);
    }
  }
  return result;
}

function candidateForReference(
  source: TargetSourceProgram,
  tracked: ReadonlyMap<Symbol, CooperativeEffectCandidate>,
  node: Node,
): CooperativeEffectCandidate | undefined {
  for (const symbol of exactSymbolsAt(source, node)) {
    const candidate = tracked.get(symbol);
    if (candidate !== undefined) {
      return candidate;
    }
  }
  return undefined;
}

function exactSymbolsAt(
  source: TargetSourceProgram,
  node: Node | undefined,
): readonly Symbol[] {
  const symbol = source.navigation.sourceReferenceFor(node)?.symbol;
  return symbol === undefined ? [] : [symbol];
}

function hasRetainedDependency(
  dependencies: Iterable<Node>,
  candidates: ReadonlyMap<Node, CooperativeEffectCandidate>,
  optimized: ReadonlySet<Node>,
): boolean {
  for (const declaration of dependencies) {
    if (candidates.has(declaration) && !optimized.has(declaration)) {
      return true;
    }
  }
  return false;
}

function enclosingCandidate(
  source: TargetSourceProgram,
  candidates: ReadonlyMap<Node, CooperativeEffectCandidate>,
  node: Node,
): CooperativeEffectCandidate | undefined {
  let current = source.ast.parent(node);
  while (current !== undefined) {
    if (isFunctionLike(source, current)) {
      return candidates.get(current);
    }
    current = source.ast.parent(current);
  }
  return undefined;
}
