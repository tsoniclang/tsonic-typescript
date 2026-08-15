import type { Node, Symbol } from "@tsonic/tsts";
import type { TargetSourceProgram } from "@tsonic/target-api";
import { KindCallExpression } from "@tsonic/tsts/target-ast";

import type { TargetProgramIndex } from "../program-index.js";
import type { StorageOwnerTransportContract } from "../storage-owner-transport.js";

import {
  collectCallableValueInputs,
  type CallableValueInputs,
} from "./value-inputs.js";
import {
  exactCallableTarget,
  isFunctionLike,
  transparentExpression,
} from "./syntax.js";
import {
  callableUsesSynchronousTransport,
  resolvedCallUsesSynchronousTransport,
} from "./synchronous.js";
import type { CallableReturnRewrite } from "./callable-contract.js";
import { createCallableResultInputs } from "./callable-result-inputs.js";
import {
  closeResolutionFromSynchronousCalls,
  closeSynchronousDependencies,
  emptyResolution,
  sealResolutions,
  markResolutionUnclosed,
  mergeResolution,
  type MutableCallableValueResolution,
  resolutionHasDependencies,
  resolutionIsClosed,
  resolutionWith,
  synchronousResolutionWith,
  unresolved,
} from "./value-resolution.js";
import type { CallableValueResolution } from "./value-resolution.js";

export type { CallableValueResolution } from "./value-resolution.js";

export interface CallableValueFlow {
  readonly signatureFamilies: readonly (readonly Node[])[];
  forEachCall(
    visitor: (call: Node, resolution: CallableValueResolution) => void,
  ): void;
  resolutionFor(call: Node | undefined): CallableValueResolution | undefined;
  allowsCandidateReference(node: Node): boolean;
  settledReturnTypes(
    optimized: ReadonlySet<Node>,
  ): readonly CallableReturnRewrite[];
}

type MutableResolution = MutableCallableValueResolution;

interface MutableReturnTypeContract {
  readonly rewrite: CallableReturnRewrite;
  readonly resolutions: MutableResolution[];
}

interface ReturnedContractResolution {
  readonly returnTypes: readonly CallableReturnRewrite[];
  readonly resolution: MutableResolution;
}

interface DirectResolutionCache {
  readonly candidates: Map<Node, MutableResolution>;
  readonly synchronous: Map<Node, MutableResolution>;
}

export function createCallableValueFlow(
  source: TargetSourceProgram,
  program: TargetProgramIndex,
  candidates: ReadonlySet<Node>,
  transports?: StorageOwnerTransportContract,
): CallableValueFlow {
  const candidateSymbols = indexCandidateSymbols(source, candidates);
  const inputs = collectCallableValueInputs(source, program, transports);
  const results = createCallableResultInputs(source, program);
  const allowedCandidateReferences = new Set<Node>();
  const mutableResolutions = new Map<Node, MutableResolution>();
  const callsByOwner = new Map<Node, MutableResolution[]>();
  const returnedContracts = new Map<Node, ReturnedContractResolution>();
  const directResolutions: DirectResolutionCache = {
    candidates: new Map(),
    synchronous: new Map(),
  };
  for (const node of program.nodesOfKind(KindCallExpression)) {
    const resolution = resolveCall(
      source,
      node,
      candidates,
      candidateSymbols,
      inputs,
      results,
      returnedContracts,
      allowedCandidateReferences,
      directResolutions,
    );
    if (resolution !== undefined) {
      mutableResolutions.set(node, resolution);
      const owner = containingFunction(source, node);
      if (owner !== undefined) {
        appendResolution(callsByOwner, owner, resolution);
      }
    }
  }
  const contractResolutions = inputs.contracts.map((contract) => {
    const resolution = emptyResolution();
    for (const declaration of contract.extractedDeclarations) {
      mergeResolution(
        resolution,
        resolveDeclaration(
          source,
          declaration,
          candidates,
          candidateSymbols,
          inputs,
          results,
          returnedContracts,
          allowedCandidateReferences,
          new Set(),
        ),
      );
    }
    return {
      returnType: contract.returnType,
      resolution,
    };
  });
  const storageContractResolutions = inputs.storageContracts.map((contract) =>
    {
      const resolution = emptyResolution();
      for (const declaration of contract.declarations) {
        mergeResolution(resolution, resolveDeclaration(
          source,
          declaration,
          candidates,
          candidateSymbols,
          inputs,
          results,
          returnedContracts,
          allowedCandidateReferences,
          new Set(),
        ));
      }
      return {
        returnTypes: contract.returnTypes,
        resolution,
      };
    }
  );
  closeSynchronousDependencies(mutableResolutions.values(), callsByOwner);
  for (const { resolution } of contractResolutions) {
    closeResolutionFromSynchronousCalls(resolution, callsByOwner);
  }
  for (const { resolution } of storageContractResolutions) {
    closeResolutionFromSynchronousCalls(resolution, callsByOwner);
  }
  for (const { resolution } of returnedContracts.values()) {
    closeResolutionFromSynchronousCalls(resolution, callsByOwner);
  }
  const returnTypeContracts = new Map<Node, MutableReturnTypeContract>();
  for (const { returnType, resolution } of contractResolutions) {
    appendReturnTypeContract(returnTypeContracts, returnType, resolution);
  }
  for (const { returnTypes, resolution } of storageContractResolutions) {
    for (const returnType of returnTypes) {
      appendReturnTypeContract(returnTypeContracts, returnType, resolution);
    }
  }
  for (const { returnTypes, resolution } of returnedContracts.values()) {
    for (const returnType of returnTypes) {
      appendReturnTypeContract(returnTypeContracts, returnType, resolution);
    }
  }
  sealResolutions(
    mutableResolutions.values(),
    contractResolutions.map(({ resolution }) => resolution),
    storageContractResolutions.map(({ resolution }) => resolution),
    [...returnedContracts.values()].map(({ resolution }) => resolution),
  );
  const signatureFamilies = Object.freeze(contractResolutions
    .filter(({ resolution }) => resolution.closed)
    .map(({ resolution }) =>
      Object.freeze([...resolution.dependencyNodes()])
    )
    .filter((family) => family.length !== 0));
  return Object.freeze({
    signatureFamilies,
    forEachCall(
      visitor: (call: Node, resolution: CallableValueResolution) => void,
    ): void {
      for (const [call, resolution] of mutableResolutions) {
        visitor(call, resolution);
      }
    },
    resolutionFor(call: Node | undefined) {
      return call === undefined ? undefined : mutableResolutions.get(call);
    },
    allowsCandidateReference(node: Node) {
      return allowedCandidateReferences.has(node);
    },
    settledReturnTypes(optimized: ReadonlySet<Node>) {
      return Object.freeze([...returnTypeContracts.values()]
        .filter(({ resolutions }) =>
          resolutions.every((resolution) =>
            resolution.closed &&
            allDependenciesAreOptimized(resolution, optimized)
          )
        )
        .map(({ rewrite }) => rewrite));
    },
  });
}

function allDependenciesAreOptimized(
  resolution: CallableValueResolution,
  optimized: ReadonlySet<Node>,
): boolean {
  for (const dependency of resolution.dependencyNodes()) {
    if (!optimized.has(dependency)) {
      return false;
    }
  }
  return true;
}

function resolveCall(
  source: TargetSourceProgram,
  call: Node,
  candidates: ReadonlySet<Node>,
  candidateSymbols: ReadonlyMap<Symbol, Node>,
  inputs: CallableValueInputs,
  results: ReturnType<typeof createCallableResultInputs>,
  returnedContracts: Map<Node, ReturnedContractResolution>,
  allowedCandidateReferences: Set<Node>,
  directResolutions: DirectResolutionCache,
): MutableResolution | undefined {
  const signature = source.semantics.forNode(call).getResolvedSignature(call);
  const declaration = source.semantics.forNode(call)
    .getSignatureDeclaration(signature);
  const expression = source.ast.as.AsCallExpression(call)?.Expression;
  const target = exactCallableTarget(source, expression);
  const referenceNode = target !== undefined &&
      source.ast.is.IsPropertyAccessExpression(target)
    ? source.ast.as.AsPropertyAccessExpression(target)?.name
    : source.ast.name(target) ?? target;
  const reference = source.navigation.sourceReferenceFor(referenceNode);
  const transported = reference === undefined || !reference.project ||
      reference.declaration === declaration
    ? undefined
    : resolveDeclaration(
      source,
      reference.declaration,
      candidates,
      candidateSymbols,
      inputs,
      results,
      returnedContracts,
      allowedCandidateReferences,
      new Set(),
    );
  if (declaration !== undefined) {
    if (candidates.has(declaration)) {
      if (transported === undefined) {
        return cachedDirectResolution(
          directResolutions.candidates,
          declaration,
          resolutionWith,
        );
      }
      const result = resolutionWith(declaration);
      mergeResolution(result, transported);
      return result;
    }
    if (resolvedCallUsesSynchronousTransport(source, call)) {
      if (transported === undefined) {
        return cachedDirectResolution(
          directResolutions.synchronous,
          declaration,
          synchronousResolutionWith,
        );
      }
      const result = synchronousResolutionWith(declaration);
      mergeResolution(result, transported);
      return result;
    }
  }
  if (reference === undefined || !reference.project) {
    return undefined;
  }
  const result = transported ?? resolveDeclaration(
    source,
    reference.declaration,
    candidates,
    candidateSymbols,
    inputs,
    results,
    returnedContracts,
    allowedCandidateReferences,
    new Set(),
  );
  return resolutionIsClosed(result) || resolutionHasDependencies(result)
    ? result
    : undefined;
}

function cachedDirectResolution(
  cache: Map<Node, MutableResolution>,
  declaration: Node,
  create: (declaration: Node) => MutableResolution,
): MutableResolution {
  const existing = cache.get(declaration);
  if (existing !== undefined) {
    return existing;
  }
  const resolution = create(declaration);
  cache.set(declaration, resolution);
  return resolution;
}

function resolveDeclaration(
  source: TargetSourceProgram,
  declaration: Node,
  candidates: ReadonlySet<Node>,
  candidateSymbols: ReadonlyMap<Symbol, Node>,
  inputs: CallableValueInputs,
  results: ReturnType<typeof createCallableResultInputs>,
  returnedContracts: Map<Node, ReturnedContractResolution>,
  allowedCandidateReferences: Set<Node>,
  pending: Set<Node>,
): MutableResolution {
  if (pending.has(declaration)) {
    return emptyResolution();
  }
  if (candidates.has(declaration)) {
    return resolutionWith(declaration);
  }
  if (callableUsesSynchronousTransport(source, declaration)) {
    return synchronousResolutionWith(declaration);
  }
  const values = inputs.valuesFor(declaration);
  if (values === undefined || !inputs.isClosed(declaration)) {
    return unresolved();
  }
  pending.add(declaration);
  const result = emptyResolution();
  for (const value of values) {
    mergeResolution(
      result,
      resolveExpression(
        source,
        value,
        candidates,
        candidateSymbols,
        inputs,
        results,
        returnedContracts,
        allowedCandidateReferences,
        pending,
      ),
    );
  }
  pending.delete(declaration);
  return result;
}

function resolveExpression(
  source: TargetSourceProgram,
  expression: Node,
  candidates: ReadonlySet<Node>,
  candidateSymbols: ReadonlyMap<Symbol, Node>,
  inputs: CallableValueInputs,
  results: ReturnType<typeof createCallableResultInputs>,
  returnedContracts: Map<Node, ReturnedContractResolution>,
  allowedCandidateReferences: Set<Node>,
  pending: Set<Node>,
): MutableResolution {
  const root = transparentExpression(source, expression);
  if (root === undefined) {
    return unresolved();
  }
  if (source.ast.is.IsConditionalExpression(root)) {
    const conditional = source.ast.as.AsConditionalExpression(root);
    const result = emptyResolution();
    for (const branch of [conditional?.WhenTrue, conditional?.WhenFalse]) {
      if (branch === undefined) {
        markResolutionUnclosed(result);
      } else {
        mergeResolution(result, resolveExpression(
          source,
          branch,
          candidates,
          candidateSymbols,
          inputs,
          results,
          returnedContracts,
          allowedCandidateReferences,
          pending,
        ));
      }
    }
    return result;
  }
  const selectedType = source.semantics.forNode(root).getTypeAtLocation(root);
  if (
    source.ast.is.IsVoidExpression(root) ||
    (selectedType !== undefined && source.semantics.forNode(root).isNullish(selectedType))
  ) {
    return emptyResolution();
  }
  if (
    source.ast.is.IsArrowFunction(root) ||
    source.ast.is.IsFunctionExpression(root)
  ) {
    if (candidates.has(root)) {
      allowedCandidateReferences.add(root);
      return resolutionWith(root);
    }
    return callableUsesSynchronousTransport(source, root)
      ? synchronousResolutionWith(root)
      : unresolved();
  }
  const returned = results.resultFor(root);
  if (returned !== undefined) {
    const existing = returnedContracts.get(returned.declaration);
    if (existing !== undefined) {
      return existing.resolution;
    }
    if (pending.has(returned.declaration)) {
      return unresolved();
    }
    pending.add(returned.declaration);
    const result = emptyResolution();
    for (const expression of returned.expressions) {
      if (expression !== undefined) {
        mergeResolution(result, resolveExpression(
          source,
          expression,
          candidates,
          candidateSymbols,
          inputs,
          results,
          returnedContracts,
          allowedCandidateReferences,
          pending,
        ));
      }
    }
    pending.delete(returned.declaration);
    returnedContracts.set(returned.declaration, {
      returnTypes: returned.returnTypes,
      resolution: result,
    });
    return result;
  }
  const referenceNode = source.ast.is.IsPropertyAccessExpression(root)
    ? source.ast.as.AsPropertyAccessExpression(root)?.name
    : source.ast.name(root) ?? root;
  const candidate = candidateForReference(
    source,
    candidateSymbols,
    referenceNode,
  );
  if (candidate !== undefined) {
    if (referenceNode !== undefined) {
      allowedCandidateReferences.add(referenceNode);
    }
    return resolutionWith(candidate);
  }
  const reference = source.navigation.sourceReferenceFor(referenceNode);
  return reference === undefined
    ? unresolved()
    : resolveDeclaration(
      source,
      reference.declaration,
      candidates,
      candidateSymbols,
      inputs,
      results,
      returnedContracts,
      allowedCandidateReferences,
      pending,
    );
}

function indexCandidateSymbols(
  source: TargetSourceProgram,
  candidates: ReadonlySet<Node>,
): ReadonlyMap<Symbol, Node> {
  const result = new Map<Symbol, Node>();
  for (const candidate of candidates) {
    for (const symbol of exactSymbolsAt(source, source.ast.name(candidate))) {
      result.set(symbol, candidate);
    }
  }
  return result;
}

function candidateForReference(
  source: TargetSourceProgram,
  candidates: ReadonlyMap<Symbol, Node>,
  node: Node | undefined,
): Node | undefined {
  for (const symbol of exactSymbolsAt(source, node)) {
    const candidate = candidates.get(symbol);
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
  const result = new Set<Symbol>();
  for (const symbol of [
    semantics.getSymbolAtLocation(node),
    semantics.getResolvedSymbol(node),
  ]) {
    if (symbol !== undefined) {
      result.add(symbol);
    }
  }
  return [...result];
}

function appendReturnTypeContract(
  target: Map<Node, MutableReturnTypeContract>,
  rewrite: CallableReturnRewrite,
  resolution: MutableResolution,
): void {
  const existing = target.get(rewrite.target);
  if (existing === undefined) {
    target.set(rewrite.target, { rewrite, resolutions: [resolution] });
    return;
  }
  if (
    existing.rewrite.selection.kind !== rewrite.selection.kind ||
    existing.rewrite.selection.index !== rewrite.selection.index
  ) {
    throw new Error("callable return contract has conflicting exact selections");
  }
  if (!existing.resolutions.includes(resolution)) {
    existing.resolutions.push(resolution);
  }
}

function appendResolution(
  target: Map<Node, MutableResolution[]>,
  owner: Node,
  resolution: MutableResolution,
): void {
  const resolutions = target.get(owner);
  if (resolutions === undefined) {
    target.set(owner, [resolution]);
  } else {
    resolutions.push(resolution);
  }
}

function containingFunction(
  source: TargetSourceProgram,
  node: Node,
): Node | undefined {
  let current = source.ast.parent(node);
  while (current !== undefined) {
    if (isFunctionLike(source, current)) {
      return current;
    }
    current = source.ast.parent(current);
  }
  return undefined;
}
