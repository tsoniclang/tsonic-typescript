import type { Node, Symbol } from "@tsonic/tsts";
import type { TargetSourceProgram } from "@tsonic/target-api";
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
  exactReturnedCall,
  isDiscardedCall,
  isFunctionLike,
  isModuleForwardingReference,
} from "../model/syntax.js";
import type { CallableValueFlow } from "../flow/callable/value-flow.js";

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
  for (const node of program.nodesOfKind(KindIdentifier)) {
    const candidate = candidateForReference(source, tracked, node);
    if (
      candidate === undefined ||
      node === source.ast.name(candidate.declaration) ||
      isModuleForwardingReference(source, node) ||
      valueFlow.allowsCandidateReference(node)
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
      !valueFlow.allowsCandidateReference(candidate.declaration) &&
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
    if (
      containingAwait(source, call) !== undefined ||
      isDiscardedCall(source, call)
    ) {
      continue;
    }
    const owner = enclosingCandidate(source, candidates, call);
    if (owner !== undefined && containingReturn(source, call) !== undefined) {
      owner.dependencies.add(candidate);
      continue;
    }
    if (returnedCallHasClosedConsumers(call)) {
      continue;
    }
    blockCooperativeEffect(candidate, "promise-observed", call);
  }
  for (const [call, family] of interfaces.calls) {
    if (
      containingAwait(source, call) !== undefined ||
      isDiscardedCall(source, call)
    ) {
      continue;
    }
    const owner = enclosingCandidate(source, candidates, call);
    if (owner !== undefined && containingReturn(source, call) !== undefined) {
      interfaces.addDependencies(owner, family);
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
    if (resolution.closed && containingAwait(source, call) !== undefined) {
      return;
    }
    const owner = enclosingCandidate(source, candidates, call);
    if (
      resolution.closed &&
      owner !== undefined &&
      containingReturn(source, call) !== undefined
    ) {
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
    const call = exactCallExpression(
      source,
      source.ast.as.AsAwaitExpression(node)?.Expression,
    );
    if (call === undefined) {
      continue;
    }
    const direct = calls.get(call);
    const family = interfaces.calls.get(call);
    const resolution = direct === undefined
      ? valueFlow.resolutionFor(call)
      : undefined;
    const dependencies: Iterable<Node> = direct === undefined
      ? resolution?.dependencyNodes() ?? noDependencies
      : [direct.declaration];
    if (
      (direct === undefined &&
        family === undefined &&
        (resolution === undefined || !resolution.closed)) ||
      (family !== undefined && !interfaces.callIsSettled(call, optimized)) ||
      hasRetainedDependency(dependencies, candidates, optimized) ||
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
  if (dependency !== undefined) {
    owner.dependencies.add(dependency);
    return;
  }
  const family = call === undefined ? undefined : interfaces.calls.get(call);
  if (family !== undefined) {
    interfaces.addDependencies(owner, family);
    return;
  }
  const resolution = valueFlow.resolutionFor(call);
  if (call === undefined || resolution === undefined || !resolution.closed) {
    blockCooperativeEffect(
      owner,
      "unresolved-call",
      call ?? expression ?? node,
    );
    return;
  }
  for (const declaration of resolution.dependencyNodes()) {
    const candidate = candidates.get(declaration);
    if (candidate === undefined) {
      blockCooperativeEffect(owner, "unresolved-call", call);
      return;
    }
    owner.dependencies.add(candidate);
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
      !source.semantics.forNode(node).isVoidLike(owner.innerType)
    ) {
      blockCooperativeEffect(owner, "incompatible-return", node);
    }
    return;
  }
  const returnedCall = exactReturnedCall(source, expression);
  const dependency = returnedCall === undefined
    ? undefined
    : calls.get(returnedCall);
  if (dependency !== undefined) {
    owner.dependencies.add(dependency);
    return;
  }
  const family = returnedCall === undefined
    ? undefined
    : interfaces.calls.get(returnedCall);
  if (family !== undefined) {
    interfaces.addDependencies(owner, family);
    return;
  }
  if (returnedCall !== undefined) {
    const resolution = valueFlow.resolutionFor(returnedCall);
    if (resolution !== undefined && resolution.closed) {
      for (const declaration of resolution.dependencyNodes()) {
        const candidate = candidates.get(declaration);
        if (candidate === undefined) {
          blockCooperativeEffect(owner, "unresolved-call", returnedCall);
          return;
        }
        owner.dependencies.add(candidate);
      }
      if (
        resolution.synchronousDeclarationCount === 0 ||
        returnFlow.callResultIsDefinitelyNonThenable(
          returnedCall,
          resolution.synchronousDeclarationNodes(),
          conditionalSettlements(resolution.dependencyNodes()),
        )
      ) {
        return;
      }
    }
  }
  if (!returnFlow.isDefinitelyNonThenable(expression)) {
    blockCooperativeEffect(owner, "promise-producing-return", expression);
  }
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
    const reference = source.navigation.sourceReferenceFor(name);
    if (reference?.declaration === candidate.declaration) {
      result.set(reference.symbol, candidate);
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
  if (node === undefined) {
    return [];
  }
  const semantics = source.semantics.forNode(node);
  const symbols = new Set<Symbol>();
  const direct = semantics.getSymbolAtLocation(node);
  const resolved = semantics.getResolvedSymbol(node);
  if (direct !== undefined) {
    symbols.add(direct);
  }
  if (resolved !== undefined) {
    symbols.add(resolved);
  }
  return [...symbols];
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
