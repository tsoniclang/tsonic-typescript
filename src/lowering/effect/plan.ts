import type {
  Node,
  SourceFile,
  Symbol,
  Type,
} from "@tsonic/tsts";
import { KindAsyncKeyword } from "@tsonic/tsts/target-ast";
import type { TargetSourceProgram } from "@tsonic/target-api";
import { propagateEffectBlockers } from "./blocker-propagation.js";
import { createCooperativeEffectPlanLifecycle } from "./lifecycle.js";
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

interface MutableCallable {
  readonly declaration: Node;
  readonly sourceFile: SourceFile;
  readonly innerType: Type;
  readonly dependencies: Set<MutableCallable>;
  blocked: boolean;
}
export interface CooperativeEffectFilePlan {
  readonly callables: readonly Node[];
  readonly awaits: readonly Node[];
  readonly asyncModifiers: readonly Node[];
}

export interface CooperativeEffectPlan {
  readonly source: TargetSourceProgram;
  begin(sourceFile: SourceFile): CooperativeEffectFilePlan;
  finishFile(sourceFile: SourceFile): void;
  finish(): void;
}

export function createClosedCooperativeEffectPlan(
  source: TargetSourceProgram,
): CooperativeEffectPlan {
  const candidates = collectCandidates(source);
  const calls = collectCalls(source, candidates);
  classifyProgramEvidence(source, candidates, calls);
  classifyCallUses(source, candidates, calls);
  propagateEffectBlockers(candidates.values());
  const optimized = new Set(
    [...candidates.values()]
      .filter((candidate) => !candidate.blocked)
      .map((candidate) => candidate.declaration),
  );
  const awaits = collectSettledAwaits(source, calls, optimized);
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
  return createCooperativeEffectPlanLifecycle(source, files);
}

function collectCandidates(
  source: TargetSourceProgram,
): Map<Node, MutableCallable> {
  const candidates = new Map<Node, MutableCallable>();
  forEachProgramNode(source, (node) => {
    if (!isSupportedAsyncCallable(source, node)) {
      return;
    }
    const typeNode = source.ast.typeNode(node);
    const typeArguments = source.ast.typeArguments(typeNode);
    const innerTypeNode = typeArguments[0];
    if (
      typeNode === undefined ||
      !source.ast.is.IsTypeReferenceNode(typeNode) ||
      typeArguments.length !== 1 ||
      innerTypeNode === undefined
    ) {
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
    candidates.set(node, {
      declaration: node,
      sourceFile,
      innerType,
      dependencies: new Set(),
      blocked: false,
    });
  });
  return candidates;
}

function isSupportedAsyncCallable(
  source: TargetSourceProgram,
  node: Node,
): boolean {
  const functionDeclaration = source.ast.is.IsFunctionDeclaration(node);
  const staticMethod = source.ast.is.IsMethodDeclaration(node) &&
    source.ast.hasModifierKind(node, "static");
  if (
    (!functionDeclaration && !staticMethod) ||
    !source.ast.hasModifierKind(node, "async") ||
    source.ast.body(node) === undefined
  ) {
    return false;
  }
  const parsed = functionDeclaration
    ? source.ast.as.AsFunctionDeclaration(node)
    : source.ast.as.AsMethodDeclaration(node);
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
  if (dependency === undefined) {
    owner.blocked = true;
    return;
  }
  owner.dependencies.add(dependency);
}

function classifyReturnDependencies(
  source: TargetSourceProgram,
  candidates: ReadonlyMap<Node, MutableCallable>,
  calls: ReadonlyMap<Node, MutableCallable>,
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
    owner.blocked ||= !source.semantics.forNode(node).isVoidLike(
      owner.innerType,
    );
    return;
  }
  const returnedCall = exactReturnedCall(source, expression);
  const dependency = returnedCall === undefined
    ? undefined
    : calls.get(returnedCall);
  if (dependency !== undefined) {
    owner.dependencies.add(dependency);
    owner.blocked ||= !sameSelectedType(
      source.semantics.forNode(expression),
      owner.innerType,
      dependency.innerType,
    );
    return;
  }
  owner.blocked ||= !expressionFitsInnerType(source, expression, owner.innerType);
}

function classifyCallUses(
  source: TargetSourceProgram,
  candidates: ReadonlyMap<Node, MutableCallable>,
  calls: ReadonlyMap<Node, MutableCallable>,
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
    candidate.blocked = true;
  }
}

function classifyProgramEvidence(
  source: TargetSourceProgram,
  candidates: ReadonlyMap<Node, MutableCallable>,
  calls: ReadonlyMap<Node, MutableCallable>,
): void {
  const tracked = indexCandidateSymbols(source, candidates.values());
  forEachProgramNode(source, (node) => {
    classifyAwaitDependencies(source, candidates, calls, node);
    classifyReturnDependencies(source, candidates, calls, node);
    if (!source.ast.is.IsIdentifier(node)) {
      return;
    }
    const candidate = candidateForReference(source, tracked, node);
    if (
      candidate === undefined ||
      node === source.ast.name(candidate.declaration) ||
      isModuleForwardingReference(source, node)
    ) {
      return;
    }
    const call = directContainingCall(source, node);
    if (call === undefined || calls.get(call) !== candidate) {
      candidate.blocked = true;
    }
  });
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
  calls: ReadonlyMap<Node, MutableCallable>,
  optimized: ReadonlySet<Node>,
): ReadonlySet<Node> {
  const awaits = new Set<Node>();
  for (const [call, candidate] of calls) {
    if (!optimized.has(candidate.declaration)) {
      continue;
    }
    const awaitExpression = containingAwait(source, call);
    if (awaitExpression !== undefined) {
      awaits.add(awaitExpression);
    }
  }
  return awaits;
}

function expressionFitsInnerType(
  source: TargetSourceProgram,
  expression: Node,
  innerType: Type,
): boolean {
  const semantics = source.semantics.forNode(expression);
  const contextual = semantics.selectContextualValueType(expression);
  if (
    contextual.kind === "selected" &&
    sameSelectedType(semantics, contextual.type, innerType)
  ) {
    return true;
  }
  const selected = semantics.getTypeAtLocation(expression);
  return selected !== undefined &&
    (sameSelectedType(semantics, selected, innerType) ||
      sameSelectedType(semantics, semantics.getWidenedType(selected), innerType));
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
