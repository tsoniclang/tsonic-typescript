import type {
  Node,
  SourceFile,
  Symbol,
} from "@tsonic/tsts";
import type { TargetSourceProgram } from "@tsonic/target-api";
import {
  KindAwaitExpression,
  KindIdentifier,
  KindReturnStatement,
} from "@tsonic/tsts/target-ast";
import type { SourceIdentityResolver } from "../occurrence.js";
import type { LoweredValueContract } from "../value-contract.js";
import type { TargetProgramIndex } from "../program-index.js";
import { propagateEffectBlockers } from "./blocker-propagation.js";
import {
  collectCooperativeEffectCalls,
  collectCooperativeEffectCandidates,
  type CooperativeEffectCandidate,
} from "./candidate-inventory.js";
import {
  blockCooperativeEffect,
  decideCooperativeEffectRetentions,
  type CooperativeEffectPlanSummary,
  summarizeCooperativeEffects,
} from "./fallback.js";
import { createCooperativeEffectPlanLifecycle } from "./lifecycle.js";
import {
  createReturnValueFlow,
  type ReturnValueFlow,
} from "./return-value.js";
import { createCooperativeResultConsumption } from "./result-consumption.js";
import {
  createCooperativeEffectFilePlans,
  type CooperativeEffectFilePlan,
} from "./file-plan.js";
import {
  containingAwait,
  containingReturn,
  directContainingCall,
  exactCallExpression,
  exactReturnedCall,
  isDiscardedCall,
  isFunctionLike,
  isModuleForwardingReference,
} from "./syntax.js";
import {
  createCallableValueFlow,
  type CallableValueFlow,
} from "./value-flow.js";
export type { CooperativeEffectFilePlan } from "./file-plan.js";

export interface CooperativeEffectPlan {
  readonly source: TargetSourceProgram;
  readonly summary: CooperativeEffectPlanSummary;
  begin(sourceFile: SourceFile): CooperativeEffectFilePlan;
  finishFile(sourceFile: SourceFile): void;
  finish(): void;
}

export function createClosedCooperativeEffectPlan(
  source: TargetSourceProgram,
  program: TargetProgramIndex,
  sourceIdentityFor: SourceIdentityResolver,
  loweredValues?: LoweredValueContract,
): CooperativeEffectPlan {
  const candidates = collectCooperativeEffectCandidates(source, program);
  const calls = collectCooperativeEffectCalls(source, program, candidates);
  const valueFlow = createCallableValueFlow(
    source,
    program,
    new Set(candidates.keys()),
  );
  connectSignatureFamilies(candidates, valueFlow.signatureFamilies);
  const returnFlow = createReturnValueFlow(
    source,
    program,
    (call) => calls.get(call)?.declaration,
    loweredValues,
    (call) => valueFlow.resolutionFor(call)?.dependencies ?? [],
  );
  const resultConsumption = createCooperativeResultConsumption(
    source,
    program,
    new Set(candidates.keys()),
  );
  const conditionalSettlements = createConditionalSettlementOwner(
    candidates.keys(),
  );
  classifyProgramEvidence(
    source,
    program,
    candidates,
    calls,
    valueFlow,
    returnFlow,
    conditionalSettlements,
  );
  classifyCallUses(
    source,
    candidates,
    calls,
    valueFlow,
    resultConsumption.returnedCallHasClosedConsumers,
  );
  const propagation = propagateEffectBlockers(candidates.values());
  const candidateList = [...candidates.values()];
  const retentions = decideCooperativeEffectRetentions(
    candidateList,
  );
  const optimized = new Set(
    candidateList
      .filter((candidate) => !retentions.has(candidate))
      .map((candidate) => candidate.declaration),
  );
  const awaits = collectSettledAwaits(
    source,
    program,
    candidates,
    calls,
    valueFlow,
    returnFlow,
    optimized,
  );
  const returnTypes = valueFlow.settledReturnTypes(optimized);
  const files = createCooperativeEffectFilePlans(
    source,
    candidates.values(),
    optimized,
    awaits,
    returnTypes,
  );
  const summary = summarizeCooperativeEffects(
    source,
    sourceIdentityFor,
    candidateList,
    retentions,
    optimized.size,
    awaits.size,
    propagation,
    resultConsumption.evidence(),
  );
  return createCooperativeEffectPlanLifecycle(source, files, summary);
}

function connectSignatureFamilies(
  candidates: ReadonlyMap<Node, CooperativeEffectCandidate>,
  families: readonly (readonly Node[])[],
): void {
  for (const family of families) {
    for (const declaration of family) {
      const candidate = candidates.get(declaration);
      if (candidate === undefined) {
        continue;
      }
      for (const related of family) {
        const dependency = candidates.get(related);
        if (dependency !== undefined && dependency !== candidate) {
          candidate.dependencies.add(dependency);
        }
      }
    }
  }
}

function classifyAwaitDependencies(
  source: TargetSourceProgram,
  candidates: ReadonlyMap<Node, CooperativeEffectCandidate>,
  calls: ReadonlyMap<Node, CooperativeEffectCandidate>,
  valueFlow: CallableValueFlow,
  returnFlow: ReturnValueFlow,
  conditionalSettlements: (dependencies: readonly Node[]) =>
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
  const resolution = valueFlow.resolutionFor(call);
  if (call === undefined || resolution === undefined || !resolution.closed) {
    blockCooperativeEffect(
      owner,
      "unresolved-call",
      call ?? expression ?? node,
    );
    return;
  }
  for (const declaration of resolution.dependencies) {
    const candidate = candidates.get(declaration);
    if (candidate === undefined) {
      blockCooperativeEffect(owner, "unresolved-call", call ?? node);
      return;
    }
    owner.dependencies.add(candidate);
  }
  if (
    resolution.synchronousDeclarations.length !== 0 &&
    !returnFlow.callResultIsDefinitelyNonThenable(
      call,
      resolution.synchronousDeclarations,
      conditionalSettlements(resolution.dependencies),
    )
  ) {
    blockCooperativeEffect(owner, "promise-observed", call);
  }
}

function classifyReturnDependencies(
  source: TargetSourceProgram,
  candidates: ReadonlyMap<Node, CooperativeEffectCandidate>,
  calls: ReadonlyMap<Node, CooperativeEffectCandidate>,
  valueFlow: CallableValueFlow,
  returnFlow: ReturnValueFlow,
  conditionalSettlements: (dependencies: readonly Node[]) =>
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
  if (returnedCall !== undefined) {
    const resolution = valueFlow.resolutionFor(returnedCall);
    if (resolution !== undefined && resolution.closed) {
      for (const declaration of resolution.dependencies) {
        const candidate = candidates.get(declaration);
        if (candidate === undefined) {
          blockCooperativeEffect(owner, "unresolved-call", returnedCall);
          return;
        }
        owner.dependencies.add(candidate);
      }
      if (
        resolution.synchronousDeclarations.length === 0 ||
        returnFlow.callResultIsDefinitelyNonThenable(
          returnedCall,
          resolution.synchronousDeclarations,
          conditionalSettlements(resolution.dependencies),
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

function classifyCallUses(
  source: TargetSourceProgram,
  candidates: ReadonlyMap<Node, CooperativeEffectCandidate>,
  calls: ReadonlyMap<Node, CooperativeEffectCandidate>,
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
    const returned = containingReturn(source, call);
    if (owner !== undefined && returned !== undefined) {
      owner.dependencies.add(candidate);
      continue;
    }
    if (returnedCallHasClosedConsumers(call)) {
      continue;
    }
    blockCooperativeEffect(candidate, "promise-observed", call);
  }
  for (const { call, resolution } of valueFlow.calls) {
    if (calls.has(call) || resolution.dependencies.length === 0) {
      continue;
    }
    if (
      resolution.closed &&
      containingAwait(source, call) !== undefined
    ) {
      continue;
    }
    const owner = enclosingCandidate(source, candidates, call);
    if (
      resolution.closed &&
      owner !== undefined &&
      containingReturn(source, call) !== undefined
    ) {
      continue;
    }
    if (resolution.closed && returnedCallHasClosedConsumers(call)) {
      continue;
    }
    for (const declaration of resolution.dependencies) {
      const candidate = candidates.get(declaration);
      if (candidate !== undefined) {
        blockCooperativeEffect(candidate, "promise-observed", call);
      }
    }
  }
}

function classifyProgramEvidence(
  source: TargetSourceProgram,
  program: TargetProgramIndex,
  candidates: ReadonlyMap<Node, CooperativeEffectCandidate>,
  calls: ReadonlyMap<Node, CooperativeEffectCandidate>,
  valueFlow: CallableValueFlow,
  returnFlow: ReturnValueFlow,
  conditionalSettlements: (dependencies: readonly Node[]) =>
    ReadonlySet<Node> | undefined,
): void {
  const tracked = indexCandidateSymbols(source, candidates.values());
  for (const node of program.nodesOfKind(KindAwaitExpression)) {
    classifyAwaitDependencies(
      source,
      candidates,
      calls,
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

interface ConditionalSettlementTrie {
  readonly next: Map<Node, ConditionalSettlementTrie>;
  value?: ReadonlySet<Node>;
}

function createConditionalSettlementOwner(
  candidates: Iterable<Node>,
): (dependencies: readonly Node[]) => ReadonlySet<Node> | undefined {
  const order = new Map([...candidates].map((candidate, index) => [
    candidate,
    index,
  ]));
  const root: ConditionalSettlementTrie = { next: new Map() };
  return (dependencies) => {
    if (dependencies.length === 0) {
      return undefined;
    }
    const selected = [...new Set(dependencies)].sort((left, right) => {
      const leftOrder = order.get(left);
      const rightOrder = order.get(right);
      if (leftOrder === undefined || rightOrder === undefined) {
        throw new Error("conditional settlement references a non-candidate");
      }
      return leftOrder - rightOrder;
    });
    let current = root;
    for (const declaration of selected) {
      let next = current.next.get(declaration);
      if (next === undefined) {
        next = { next: new Map() };
        current.next.set(declaration, next);
      }
      current = next;
    }
    current.value ??= Object.freeze(new Set(selected));
    return current.value;
  };
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

function collectSettledAwaits(
  source: TargetSourceProgram,
  program: TargetProgramIndex,
  candidates: ReadonlyMap<Node, CooperativeEffectCandidate>,
  calls: ReadonlyMap<Node, CooperativeEffectCandidate>,
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
    const resolution = direct === undefined
      ? valueFlow.resolutionFor(call)
      : undefined;
    const dependencies = direct === undefined
      ? resolution?.dependencies ?? []
      : [direct.declaration];
    if (
      (direct === undefined && (resolution === undefined || !resolution.closed)) ||
      dependencies.some((declaration) =>
        candidates.has(declaration) && !optimized.has(declaration)
      ) ||
      (direct === undefined &&
        resolution !== undefined &&
        resolution.synchronousDeclarations.length !== 0 &&
        !returnFlow.callResultIsDefinitelyNonThenable(
          call,
          resolution.synchronousDeclarations,
          optimized,
        ))
    ) {
      continue;
    }
    awaits.add(node);
  }
  return awaits;
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
