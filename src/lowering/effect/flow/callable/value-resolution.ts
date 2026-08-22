import type { Node } from "@tsonic/tsts";
import type { ExactProvenanceValueSet } from "../../provenance/origin-index.js";

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
  return createExactCallableValueResolution(
    closed,
    arrayNodeSet(selectedDependencies),
    arrayNodeSet(selectedSynchronous),
  );
}

export function createExactCallableValueResolution(
  closed: boolean,
  dependencies: ExactProvenanceValueSet<Node>,
  synchronousDeclarations: ExactProvenanceValueSet<Node>,
): CallableValueResolution {
  return Object.freeze({
    closed,
    dependencyCount: dependencies.count,
    synchronousDeclarationCount: synchronousDeclarations.count,
    dependencyNodes(): Iterable<Node> {
      return dependencies.values();
    },
    synchronousDeclarationNodes(): Iterable<Node> {
      return synchronousDeclarations.values();
    },
  });
}

function arrayNodeSet(nodes: readonly Node[]): ExactProvenanceValueSet<Node> {
  return Object.freeze({
    count: nodes.length,
    values(): Iterable<Node> {
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
