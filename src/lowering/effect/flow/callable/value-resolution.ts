import type { Node } from "@tsonic/tsts";

export interface CallableValueResolution {
  readonly closed: boolean;
  readonly dependencyCount: number;
  readonly synchronousDeclarationCount: number;
  dependencyNodes(): Iterable<Node>;
  synchronousDeclarationNodes(): Iterable<Node>;
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
  return Object.freeze({
    closed,
    dependencyCount: selectedDependencies.length,
    synchronousDeclarationCount: selectedSynchronous.length,
    dependencyNodes(): Iterable<Node> {
      return selectedDependencies;
    },
    synchronousDeclarationNodes(): Iterable<Node> {
      return selectedSynchronous;
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
