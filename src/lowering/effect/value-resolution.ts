import type { Node } from "@tsonic/tsts";

export interface CallableValueResolution {
  readonly dependencies: readonly Node[];
  readonly synchronousDeclarations: readonly Node[];
  readonly closed: boolean;
}

export interface MutableCallableValueResolution {
  readonly dependencies: Set<Node>;
  readonly synchronousDeclarations: Set<Node>;
  closed: boolean;
}

export function emptyResolution(): MutableCallableValueResolution {
  return {
    dependencies: new Set(),
    synchronousDeclarations: new Set(),
    closed: true,
  };
}

export function unresolved(): MutableCallableValueResolution {
  return {
    dependencies: new Set(),
    synchronousDeclarations: new Set(),
    closed: false,
  };
}

export function resolutionWith(
  dependency: Node,
): MutableCallableValueResolution {
  return {
    dependencies: new Set([dependency]),
    synchronousDeclarations: new Set(),
    closed: true,
  };
}

export function synchronousResolutionWith(
  declaration: Node,
): MutableCallableValueResolution {
  return {
    dependencies: new Set(),
    synchronousDeclarations: new Set([declaration]),
    closed: true,
  };
}

export function mergeResolution(
  target: MutableCallableValueResolution,
  source: MutableCallableValueResolution,
): void {
  target.closed &&= source.closed;
  for (const dependency of source.dependencies) {
    target.dependencies.add(dependency);
  }
  for (const declaration of source.synchronousDeclarations) {
    target.synchronousDeclarations.add(declaration);
  }
}

export function closeSynchronousDependencies(
  resolutions: Iterable<MutableCallableValueResolution>,
  callsByOwner: ReadonlyMap<
    Node,
    readonly MutableCallableValueResolution[]
  >,
): void {
  const all = [...resolutions];
  const dependents = new Map<
    MutableCallableValueResolution,
    Set<MutableCallableValueResolution>
  >();
  for (const resolution of all) {
    for (const declaration of resolution.synchronousDeclarations) {
      for (const nested of callsByOwner.get(declaration) ?? []) {
        const selected = dependents.get(nested);
        if (selected === undefined) {
          dependents.set(nested, new Set([resolution]));
        } else {
          selected.add(resolution);
        }
      }
    }
  }
  const pending = [...all];
  const queued = new Set(pending);
  while (pending.length !== 0) {
    const source = pending.pop();
    if (source === undefined) {
      continue;
    }
    queued.delete(source);
    for (const dependent of dependents.get(source) ?? []) {
      if (
        mergeDependencyEvidence(dependent, source) &&
        !queued.has(dependent)
      ) {
        pending.push(dependent);
        queued.add(dependent);
      }
    }
  }
}

export function closeResolutionFromSynchronousCalls(
  resolution: MutableCallableValueResolution,
  callsByOwner: ReadonlyMap<
    Node,
    readonly MutableCallableValueResolution[]
  >,
): void {
  for (const declaration of resolution.synchronousDeclarations) {
    for (const nested of callsByOwner.get(declaration) ?? []) {
      mergeDependencyEvidence(resolution, nested);
    }
  }
}

export function sealResolution(
  resolution: MutableCallableValueResolution,
): CallableValueResolution {
  return Object.freeze({
    dependencies: Object.freeze([...resolution.dependencies]),
    synchronousDeclarations: Object.freeze([
      ...resolution.synchronousDeclarations,
    ]),
    closed: resolution.closed,
  });
}

function mergeDependencyEvidence(
  target: MutableCallableValueResolution,
  source: MutableCallableValueResolution,
): boolean {
  let changed = false;
  if (target.closed && !source.closed) {
    target.closed = false;
    changed = true;
  }
  for (const dependency of source.dependencies) {
    if (!target.dependencies.has(dependency)) {
      target.dependencies.add(dependency);
      changed = true;
    }
  }
  return changed;
}
