import type { Node, Symbol } from "@tsonic/tsts";
import type { TargetSourceProgram } from "@tsonic/target-api";

import {
  collectCallableValueInputs,
  type CallableValueInputs,
} from "./value-inputs.js";
import {
  exactCallableTarget,
  forEachProgramNode,
  transparentExpression,
} from "./syntax.js";
import {
  callableIsDefinitelySynchronous,
  resolvedCallIsDefinitelySynchronous,
} from "./synchronous.js";

export interface CallableValueResolution {
  readonly dependencies: readonly Node[];
  readonly closed: boolean;
}

export interface CallableValueCall {
  readonly call: Node;
  readonly resolution: CallableValueResolution;
}

export interface CallableValueFlow {
  readonly calls: readonly CallableValueCall[];
  readonly signatureFamilies: readonly (readonly Node[])[];
  resolutionFor(call: Node | undefined): CallableValueResolution | undefined;
  allowsCandidateReference(node: Node): boolean;
  settledReturnTypes(optimized: ReadonlySet<Node>): readonly Node[];
}

interface MutableResolution {
  readonly dependencies: Set<Node>;
  closed: boolean;
}

export function createCallableValueFlow(
  source: TargetSourceProgram,
  candidates: ReadonlySet<Node>,
): CallableValueFlow {
  const candidateSymbols = indexCandidateSymbols(source, candidates);
  const inputs = collectCallableValueInputs(source);
  const allowedCandidateReferences = new Set<Node>();
  const resolutions = new Map<Node, CallableValueResolution>();
  forEachProgramNode(source, (node) => {
    if (!source.ast.is.IsCallExpression(node)) {
      return;
    }
    const resolution = resolveCall(
      source,
      node,
      candidates,
      candidateSymbols,
      inputs,
      allowedCandidateReferences,
    );
    if (resolution !== undefined) {
      resolutions.set(node, sealResolution(resolution));
    }
  });
  const calls = Object.freeze([...resolutions].map(([call, resolution]) =>
    Object.freeze({ call, resolution })
  ));
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
          allowedCandidateReferences,
          new Set(),
        ),
      );
    }
    return Object.freeze({
      returnType: contract.returnType,
      resolution: sealResolution(resolution),
    });
  });
  const objectContractResolutions = inputs.objectContracts.map((contract) =>
    {
      const resolution = emptyResolution();
      for (const declaration of contract.declarations) {
        mergeResolution(resolution, resolveDeclaration(
          source,
          declaration,
          candidates,
          candidateSymbols,
          inputs,
          allowedCandidateReferences,
          new Set(),
        ));
      }
      return Object.freeze({
        returnTypes: contract.returnTypes,
        resolution: sealResolution(resolution),
      });
    }
  );
  const signatureFamilies = Object.freeze(contractResolutions
    .filter(({ resolution }) => resolution.closed)
    .map(({ resolution }) => Object.freeze([...resolution.dependencies]))
    .filter((family) => family.length !== 0));
  return Object.freeze({
    calls,
    signatureFamilies,
    resolutionFor(call: Node | undefined) {
      return call === undefined ? undefined : resolutions.get(call);
    },
    allowsCandidateReference(node: Node) {
      return allowedCandidateReferences.has(node);
    },
    settledReturnTypes(optimized: ReadonlySet<Node>) {
      const collectionTypes = contractResolutions
        .filter(({ resolution }) =>
          resolution.closed &&
          resolution.dependencies.every((dependency) => optimized.has(dependency))
        )
        .map(({ returnType }) => returnType);
      const objectTypes = objectContractResolutions
        .filter(({ resolution }) =>
          resolution.closed &&
          resolution.dependencies.every((dependency) => optimized.has(dependency))
        )
        .flatMap(({ returnTypes }) => returnTypes);
      return Object.freeze([...collectionTypes, ...objectTypes]);
    },
  });
}

function resolveCall(
  source: TargetSourceProgram,
  call: Node,
  candidates: ReadonlySet<Node>,
  candidateSymbols: ReadonlyMap<Symbol, Node>,
  inputs: CallableValueInputs,
  allowedCandidateReferences: Set<Node>,
): MutableResolution | undefined {
  const signature = source.semantics.forNode(call).getResolvedSignature(call);
  const declaration = source.semantics.forNode(call)
    .getSignatureDeclaration(signature);
  if (declaration !== undefined) {
    if (candidates.has(declaration)) {
      return resolutionWith(declaration);
    }
    if (resolvedCallIsDefinitelySynchronous(source, call)) {
      return emptyResolution();
    }
  }
  const expression = source.ast.as.AsCallExpression(call)?.Expression;
  const target = exactCallableTarget(source, expression);
  const referenceNode = target !== undefined &&
      source.ast.is.IsPropertyAccessExpression(target)
    ? source.ast.as.AsPropertyAccessExpression(target)?.name
    : source.ast.name(target) ?? target;
  const reference = source.navigation.sourceReferenceFor(referenceNode);
  if (reference === undefined || !reference.project) {
    return undefined;
  }
  const result = resolveDeclaration(
    source,
    reference.declaration,
    candidates,
    candidateSymbols,
    inputs,
    allowedCandidateReferences,
    new Set(),
  );
  return result.closed || result.dependencies.size !== 0 ? result : undefined;
}

function resolveDeclaration(
  source: TargetSourceProgram,
  declaration: Node,
  candidates: ReadonlySet<Node>,
  candidateSymbols: ReadonlyMap<Symbol, Node>,
  inputs: CallableValueInputs,
  allowedCandidateReferences: Set<Node>,
  pending: Set<Node>,
): MutableResolution {
  if (pending.has(declaration)) {
    return emptyResolution();
  }
  if (candidates.has(declaration)) {
    return resolutionWith(declaration);
  }
  if (callableIsDefinitelySynchronous(source, declaration)) {
    return emptyResolution();
  }
  const values = inputs.values.get(declaration);
  if (values === undefined || !inputs.closed.has(declaration)) {
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
        result.closed = false;
      } else {
        mergeResolution(result, resolveExpression(
          source,
          branch,
          candidates,
          candidateSymbols,
          inputs,
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
    return callableIsDefinitelySynchronous(source, root)
      ? emptyResolution()
      : unresolved();
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
  return reference === undefined || !reference.project
    ? unresolved()
    : resolveDeclaration(
      source,
      reference.declaration,
      candidates,
      candidateSymbols,
      inputs,
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

function emptyResolution(): MutableResolution {
  return { dependencies: new Set(), closed: true };
}

function unresolved(): MutableResolution {
  return { dependencies: new Set(), closed: false };
}

function resolutionWith(dependency: Node): MutableResolution {
  return { dependencies: new Set([dependency]), closed: true };
}

function mergeResolution(
  target: MutableResolution,
  source: MutableResolution,
): void {
  target.closed &&= source.closed;
  for (const dependency of source.dependencies) {
    target.dependencies.add(dependency);
  }
}

function sealResolution(
  resolution: MutableResolution,
): CallableValueResolution {
  return Object.freeze({
    dependencies: Object.freeze([...resolution.dependencies]),
    closed: resolution.closed,
  });
}
