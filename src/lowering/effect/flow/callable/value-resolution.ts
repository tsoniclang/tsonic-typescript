import type { Node } from "@tsonic/tsts";

export interface CallableValueResolution {
  readonly closed: boolean;
  readonly dependencyCount: number;
  readonly synchronousDeclarationCount: number;
  dependencyNodes(): Iterable<Node>;
  synchronousDeclarationNodes(): Iterable<Node>;
}

export interface ExactCallableNodeSet {
  readonly count: number;
  nodes(): Iterable<Node>;
}

export function createCallableValueResolution(
  closed: boolean,
  dependencies: Iterable<Node>,
  synchronousDeclarations: Iterable<Node>,
): CallableValueResolution {
  const selectedDependencies = Object.freeze([...new Set(dependencies)]);
  const selectedSynchronous = Object.freeze([
    ...new Set(synchronousDeclarations),
  ]);
  return createExactCallableValueResolution(
    closed,
    arrayNodeSet(selectedDependencies),
    arrayNodeSet(selectedSynchronous),
  );
}

export function createExactCallableValueResolution(
  closed: boolean,
  dependencies: ExactCallableNodeSet,
  synchronousDeclarations: ExactCallableNodeSet,
): CallableValueResolution {
  return Object.freeze({
    closed,
    dependencyCount: dependencies.count,
    synchronousDeclarationCount: synchronousDeclarations.count,
    dependencyNodes(): Iterable<Node> {
      return dependencies.nodes();
    },
    synchronousDeclarationNodes(): Iterable<Node> {
      return synchronousDeclarations.nodes();
    },
  });
}

function arrayNodeSet(nodes: readonly Node[]): ExactCallableNodeSet {
  return Object.freeze({
    count: nodes.length,
    nodes(): Iterable<Node> {
      return nodes;
    },
  });
}

export function allCallableDependenciesAreOptimized(
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
