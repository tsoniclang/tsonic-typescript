import type {
  Node,
  SourceFile,
  Symbol,
  Type,
} from "@tsonic/tsts";
import { KindAsyncKeyword } from "@tsonic/tsts/target-ast";
import type { TargetSourceProgram } from "@tsonic/target-api";
import { methodDispatchIsClosed } from "../member-dispatch.js";
import { propagateEffectBlockers } from "./blocker-propagation.js";
import {
  blockCooperativeEffect,
  type CooperativeEffectFallbackReason,
  type CooperativeEffectFallbackOccurrence,
  type CooperativeEffectPlanSummary,
  summarizeCooperativeEffects,
} from "./fallback.js";
import { createCooperativeEffectPlanLifecycle } from "./lifecycle.js";
import { expressionIsDefinitelyNonThenable } from "./return-value.js";
import {
  containingAwait,
  containingReturn,
  directContainingCall,
  exactCallExpression,
  exactReturnedCall,
  forEachProgramNode,
  isDiscardedCall,
  isFunctionLike,
  isModuleForwardingReference,
} from "./syntax.js";
import {
  createCallableValueFlow,
  type CallableValueFlow,
} from "./value-flow.js";

interface MutableCallable {
  readonly declaration: Node;
  readonly sourceFile: SourceFile;
  readonly occurrence: CooperativeEffectFallbackOccurrence;
  readonly innerType: Type;
  readonly dependencies: Set<MutableCallable>;
  readonly directBlockers: Set<CooperativeEffectFallbackReason>;
  readonly blockers: Set<CooperativeEffectFallbackReason>;
}
export interface CooperativeEffectFilePlan {
  readonly callables: readonly Node[];
  readonly awaits: readonly Node[];
  readonly asyncModifiers: readonly Node[];
}

export interface CooperativeEffectPlan {
  readonly source: TargetSourceProgram;
  readonly summary: CooperativeEffectPlanSummary;
  begin(sourceFile: SourceFile): CooperativeEffectFilePlan;
  finishFile(sourceFile: SourceFile): void;
  finish(): void;
}

export function createClosedCooperativeEffectPlan(
  source: TargetSourceProgram,
  sourceIdentityFor: (sourceFile: SourceFile) => string,
): CooperativeEffectPlan {
  const candidates = collectCandidates(source, sourceIdentityFor);
  const calls = collectCalls(source, candidates);
  const valueFlow = createCallableValueFlow(
    source,
    new Set(candidates.keys()),
  );
  classifyProgramEvidence(source, candidates, calls, valueFlow);
  classifyCallUses(source, candidates, calls, valueFlow);
  const propagation = propagateEffectBlockers(candidates.values());
  const optimized = new Set(
    [...candidates.values()]
      .filter((candidate) => candidate.blockers.size === 0)
      .map((candidate) => candidate.declaration),
  );
  const awaits = collectSettledAwaits(
    source,
    candidates,
    calls,
    valueFlow,
    optimized,
  );
  const files = new Map<SourceFile, CooperativeEffectFilePlan>();
  for (const sourceFile of source.navigation.sourceFiles) {
    files.set(sourceFile, Object.freeze({
      callables: Object.freeze(
        [...candidates.values()]
          .filter((candidate) =>
            candidate.sourceFile === sourceFile &&
            optimized.has(candidate.declaration)
          )
          .map((candidate) => candidate.declaration),
      ),
      awaits: Object.freeze(
        [...awaits].filter((node) => source.ast.getSourceFile(node) === sourceFile),
      ),
      asyncModifiers: Object.freeze(
        [...candidates.values()]
          .filter((candidate) =>
            candidate.sourceFile === sourceFile &&
            optimized.has(candidate.declaration)
          )
          .flatMap((candidate) => source.ast.modifiers(candidate.declaration))
          .filter((modifier): modifier is Node =>
            modifier !== undefined &&
            modifier.Kind === KindAsyncKeyword
          ),
      ),
    }));
  }
  const summary = summarizeCooperativeEffects(
    candidates.values(),
    optimized.size,
    awaits.size,
    propagation,
  );
  return createCooperativeEffectPlanLifecycle(source, files, summary);
}

function collectCandidates(
  source: TargetSourceProgram,
  sourceIdentityFor: (sourceFile: SourceFile) => string,
): Map<Node, MutableCallable> {
  const candidates = new Map<Node, MutableCallable>();
  forEachProgramNode(source, (node) => {
    if (!isSupportedAsyncCallable(source, node)) {
      return;
    }
    const typeNode = source.ast.typeNode(node);
    if (
      typeNode === undefined ||
      !source.ast.is.IsTypeReferenceNode(typeNode)
    ) {
      return;
    }
    const typeArguments = source.ast.typeArguments(typeNode);
    const innerTypeNode = typeArguments[0];
    if (typeArguments.length !== 1 || innerTypeNode === undefined) {
      return;
    }
    const semantics = source.semantics.forNode(node);
    const returnType = semantics.getTypeFromTypeNode(typeNode);
    const innerType = semantics.getTypeFromTypeNode(innerTypeNode);
    if (
      returnType === undefined ||
      innerType === undefined ||
      !semantics.isTypeReference(returnType)
    ) {
      return;
    }
    const selectedArguments = semantics.getTypeArguments(returnType);
    if (
      selectedArguments.length !== 1 ||
      !sameSelectedType(semantics, selectedArguments[0], innerType)
    ) {
      return;
    }
    const sourceFile = source.ast.getSourceFile(node);
    if (sourceFile === undefined) {
      return;
    }
    const candidate: MutableCallable = {
      declaration: node,
      sourceFile,
      occurrence: fallbackOccurrence(source, node, sourceIdentityFor),
      innerType,
      dependencies: new Set(),
      directBlockers: new Set(),
      blockers: new Set(),
    };
    candidates.set(node, candidate);
  });
  return candidates;
}

function fallbackOccurrence(
  source: TargetSourceProgram,
  node: Node,
  sourceIdentityFor: (sourceFile: SourceFile) => string,
): CooperativeEffectFallbackOccurrence {
  const occurrence = source.documents.occurrenceFor(node);
  return occurrence.kind === "authored"
    ? Object.freeze({
        kind: "authored",
        documentIdentity: sourceIdentityFor(occurrence.document.sourceFile),
        start: occurrence.start,
        end: occurrence.end,
        syntaxKind: occurrence.syntaxKind,
      })
    : Object.freeze({
        kind: "synthetic",
        syntaxKind: occurrence.syntaxKind,
      });
}

function isSupportedAsyncCallable(
  source: TargetSourceProgram,
  node: Node,
): boolean {
  const functionDeclaration = source.ast.is.IsFunctionDeclaration(node);
  const method = source.ast.is.IsMethodDeclaration(node) &&
    methodDispatchIsClosed(source, node);
  const functionExpression = source.ast.is.IsFunctionExpression(node);
  const arrowFunction = source.ast.is.IsArrowFunction(node);
  if (
    (!functionDeclaration && !method && !functionExpression && !arrowFunction) ||
    !source.ast.hasModifierKind(node, "async") ||
    source.ast.body(node) === undefined
  ) {
    return false;
  }
  const parsed = functionDeclaration
    ? source.ast.as.AsFunctionDeclaration(node)
    : method
    ? source.ast.as.AsMethodDeclaration(node)
    : functionExpression
    ? source.ast.as.AsFunctionExpression(node)
    : source.ast.as.AsArrowFunction(node);
  return parsed?.AsteriskToken === undefined && parsed?.FullSignature === undefined;
}

function collectCalls(
  source: TargetSourceProgram,
  candidates: ReadonlyMap<Node, MutableCallable>,
): ReadonlyMap<Node, MutableCallable> {
  const calls = new Map<Node, MutableCallable>();
  forEachProgramNode(source, (node) => {
    if (!source.ast.is.IsCallExpression(node)) {
      return;
    }
    const semantics = source.semantics.forNode(node);
    const signature = semantics.getResolvedSignature(node);
    const declaration = semantics.getSignatureDeclaration(signature);
    const candidate = declaration === undefined
      ? undefined
      : candidates.get(declaration);
    if (candidate !== undefined) {
      calls.set(node, candidate);
    }
  });
  return calls;
}

function classifyAwaitDependencies(
  source: TargetSourceProgram,
  candidates: ReadonlyMap<Node, MutableCallable>,
  calls: ReadonlyMap<Node, MutableCallable>,
  valueFlow: CallableValueFlow,
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
  if (resolution === undefined || !resolution.closed) {
    blockCooperativeEffect(owner, "unresolved-call");
    return;
  }
  for (const declaration of resolution.dependencies) {
    const candidate = candidates.get(declaration);
    if (candidate === undefined) {
      blockCooperativeEffect(owner, "unresolved-call");
      return;
    }
    owner.dependencies.add(candidate);
  }
}

function classifyReturnDependencies(
  source: TargetSourceProgram,
  candidates: ReadonlyMap<Node, MutableCallable>,
  calls: ReadonlyMap<Node, MutableCallable>,
  valueFlow: CallableValueFlow,
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
    if (!source.semantics.forNode(node).isVoidLike(owner.innerType)) {
      blockCooperativeEffect(owner, "incompatible-return");
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
          blockCooperativeEffect(owner, "unresolved-call");
          return;
        }
        owner.dependencies.add(candidate);
      }
      return;
    }
  }
  if (!expressionIsDefinitelyNonThenable(source, expression)) {
    blockCooperativeEffect(owner, "promise-producing-return");
  }
}

function classifyCallUses(
  source: TargetSourceProgram,
  candidates: ReadonlyMap<Node, MutableCallable>,
  calls: ReadonlyMap<Node, MutableCallable>,
  valueFlow: CallableValueFlow,
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
    blockCooperativeEffect(candidate, "promise-observed");
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
    for (const declaration of resolution.dependencies) {
      const candidate = candidates.get(declaration);
      if (candidate !== undefined) {
        blockCooperativeEffect(candidate, "promise-observed");
      }
    }
  }
}

function classifyProgramEvidence(
  source: TargetSourceProgram,
  candidates: ReadonlyMap<Node, MutableCallable>,
  calls: ReadonlyMap<Node, MutableCallable>,
  valueFlow: CallableValueFlow,
): void {
  const tracked = indexCandidateSymbols(source, candidates.values());
  forEachProgramNode(source, (node) => {
    classifyAwaitDependencies(source, candidates, calls, valueFlow, node);
    classifyReturnDependencies(source, candidates, calls, valueFlow, node);
    if (!source.ast.is.IsIdentifier(node)) {
      return;
    }
    const candidate = candidateForReference(source, tracked, node);
    if (
      candidate === undefined ||
      node === source.ast.name(candidate.declaration) ||
      isModuleForwardingReference(source, node) ||
      valueFlow.allowsCandidateReference(node)
    ) {
      return;
    }
    const call = directContainingCall(source, node);
    if (call === undefined || calls.get(call) !== candidate) {
      blockCooperativeEffect(candidate, "escaping-callable");
    }
  });
  for (const candidate of candidates.values()) {
    if (
      (source.ast.is.IsArrowFunction(candidate.declaration) ||
        source.ast.is.IsFunctionExpression(candidate.declaration)) &&
      !valueFlow.allowsCandidateReference(candidate.declaration) &&
      directContainingCall(source, candidate.declaration) === undefined
    ) {
      blockCooperativeEffect(candidate, "escaping-callable");
    }
  }
}

function indexCandidateSymbols(
  source: TargetSourceProgram,
  candidates: Iterable<MutableCallable>,
): ReadonlyMap<Symbol, MutableCallable> {
  const result = new Map<Symbol, MutableCallable>();
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
  tracked: ReadonlyMap<Symbol, MutableCallable>,
  node: Node,
): MutableCallable | undefined {
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
  candidates: ReadonlyMap<Node, MutableCallable>,
  calls: ReadonlyMap<Node, MutableCallable>,
  valueFlow: CallableValueFlow,
  optimized: ReadonlySet<Node>,
): ReadonlySet<Node> {
  const awaits = new Set<Node>();
  forEachProgramNode(source, (node) => {
    if (!source.ast.is.IsAwaitExpression(node)) {
      return;
    }
    const call = exactCallExpression(
      source,
      source.ast.as.AsAwaitExpression(node)?.Expression,
    );
    if (call === undefined) {
      return;
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
      )
    ) {
      return;
    }
    awaits.add(node);
  });
  return awaits;
}

function sameSelectedType(
  semantics: ReturnType<TargetSourceProgram["semantics"]["forNode"]>,
  left: Type | undefined,
  right: Type | undefined,
): boolean {
  if (left === undefined || right === undefined) {
    return false;
  }
  if (left === right) {
    return true;
  }
  if (
    (semantics.isNumberLike(left) && semantics.isNumberLike(right)) ||
    (semantics.isStringLike(left) && semantics.isStringLike(right)) ||
    (semantics.isBooleanLike(left) && semantics.isBooleanLike(right)) ||
    (semantics.isBigIntLike(left) && semantics.isBigIntLike(right)) ||
    (semantics.isVoidLike(left) && semantics.isVoidLike(right))
  ) {
    return true;
  }
  if (
    !semantics.isTypeReference(left) ||
    !semantics.isTypeReference(right) ||
    semantics.getTypeReferenceTarget(left) !== semantics.getTypeReferenceTarget(right)
  ) {
    return false;
  }
  const leftArguments = semantics.getTypeArguments(left);
  const rightArguments = semantics.getTypeArguments(right);
  return leftArguments.length === rightArguments.length &&
    leftArguments.every((argument, index) =>
      sameSelectedType(semantics, argument, rightArguments[index])
    );
}

function enclosingCandidate(
  source: TargetSourceProgram,
  candidates: ReadonlyMap<Node, MutableCallable>,
  node: Node,
): MutableCallable | undefined {
  let current = source.ast.parent(node);
  while (current !== undefined) {
    if (isFunctionLike(source, current)) {
      return candidates.get(current);
    }
    current = source.ast.parent(current);
  }
  return undefined;
}
