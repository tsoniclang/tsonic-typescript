import type { Node } from "@tsonic/tsts";

export interface CallableValueResolution {
  readonly closed: boolean;
  readonly dependencyCount: number;
  readonly synchronousDeclarationCount: number;
  dependencyNodes(): Iterable<Node>;
  synchronousDeclarationNodes(): Iterable<Node>;
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

type NodeStorage = Node | Set<Node> | undefined;

export class MutableCallableValueResolution {
  #dependencies: NodeStorage;
  #synchronousDeclarations: NodeStorage;
  #closed: boolean;
  #sealed = false;

  private constructor(
    dependencies: NodeStorage,
    synchronousDeclarations: NodeStorage,
    closed: boolean,
  ) {
    this.#dependencies = dependencies;
    this.#synchronousDeclarations = synchronousDeclarations;
    this.#closed = closed;
  }

  public static empty(): MutableCallableValueResolution {
    return new MutableCallableValueResolution(undefined, undefined, true);
  }

  public static unresolved(): MutableCallableValueResolution {
    return new MutableCallableValueResolution(undefined, undefined, false);
  }

  public static withDependency(
    dependency: Node,
  ): MutableCallableValueResolution {
    return new MutableCallableValueResolution(
      dependency,
      undefined,
      true,
    );
  }

  public static withSynchronousDeclaration(
    declaration: Node,
  ): MutableCallableValueResolution {
    return new MutableCallableValueResolution(
      undefined,
      declaration,
      true,
    );
  }

  public isClosed(): boolean {
    return this.#closed;
  }

  public get closed(): boolean {
    return this.#closed;
  }

  public get dependencyCount(): number {
    return nodeStorageSize(this.#dependencies);
  }

  public get synchronousDeclarationCount(): number {
    return nodeStorageSize(this.#synchronousDeclarations);
  }

  public dependencyNodes(): Iterable<Node> {
    return nodeStorageNodes(this.#dependencies);
  }

  public synchronousDeclarationNodes(): Iterable<Node> {
    return nodeStorageNodes(this.#synchronousDeclarations);
  }

  public hasDependencies(): boolean {
    return this.#dependencies !== undefined;
  }

  public markUnclosed(): void {
    this.#assertMutable();
    this.#closed = false;
  }

  public merge(source: MutableCallableValueResolution): void {
    this.#assertMutable();
    this.#closed &&= source.isClosed();
    source.forEachDependency((dependency) => {
      this.#dependencies = addNode(this.#dependencies, dependency);
    });
    source.forEachSynchronousDeclaration((declaration) =>
      this.#synchronousDeclarations = addNode(
        this.#synchronousDeclarations,
        declaration,
      )
    );
  }

  public mergeDependencyEvidence(
    source: MutableCallableValueResolution,
  ): boolean {
    this.#assertMutable();
    let changed = false;
    if (this.#closed && !source.isClosed()) {
      this.#closed = false;
      changed = true;
    }
    source.forEachDependency((dependency) => {
      if (!nodeStorageHas(this.#dependencies, dependency)) {
        this.#dependencies = addNode(this.#dependencies, dependency);
        changed = true;
      }
    });
    return changed;
  }

  public forEachDependency(visitor: (dependency: Node) => void): void {
    for (const dependency of nodeStorageNodes(this.#dependencies)) {
      visitor(dependency);
    }
  }

  public forEachSynchronousDeclaration(
    visitor: (declaration: Node) => void,
  ): void {
    for (const declaration of nodeStorageNodes(this.#synchronousDeclarations)) {
      visitor(declaration);
    }
  }

  public seal(): CallableValueResolution {
    this.#assertMutable();
    this.#sealed = true;
    return this;
  }

  #assertMutable(): void {
    if (this.#sealed) {
      throw new Error("callable value resolution is already sealed");
    }
  }
}

function addNode(storage: NodeStorage, node: Node): NodeStorage {
  if (storage === undefined) {
    return node;
  }
  if (storage instanceof Set) {
    storage.add(node);
    return storage;
  }
  return storage === node ? storage : new Set([storage, node]);
}

function nodeStorageHas(storage: NodeStorage, node: Node): boolean {
  return storage instanceof Set ? storage.has(node) : storage === node;
}

function nodeStorageSize(storage: NodeStorage): number {
  return storage === undefined ? 0 : storage instanceof Set ? storage.size : 1;
}

function* nodeStorageNodes(storage: NodeStorage): Iterable<Node> {
  if (storage === undefined) {
    return;
  }
  if (storage instanceof Set) {
    yield* storage;
    return;
  }
  yield storage;
}

export function emptyResolution(): MutableCallableValueResolution {
  return MutableCallableValueResolution.empty();
}

export function unresolved(): MutableCallableValueResolution {
  return MutableCallableValueResolution.unresolved();
}

export function resolutionWith(
  dependency: Node,
): MutableCallableValueResolution {
  return MutableCallableValueResolution.withDependency(dependency);
}

export function synchronousResolutionWith(
  declaration: Node,
): MutableCallableValueResolution {
  return MutableCallableValueResolution.withSynchronousDeclaration(
    declaration,
  );
}

export function mergeResolution(
  target: MutableCallableValueResolution,
  source: MutableCallableValueResolution,
): void {
  target.merge(source);
}

export function resolutionIsClosed(
  resolution: MutableCallableValueResolution,
): boolean {
  return resolution.isClosed();
}

export function resolutionHasDependencies(
  resolution: MutableCallableValueResolution,
): boolean {
  return resolution.hasDependencies();
}

export function markResolutionUnclosed(
  resolution: MutableCallableValueResolution,
): void {
  resolution.markUnclosed();
}

export function closeSynchronousDependencies(
  resolutions: Iterable<MutableCallableValueResolution>,
  callsByOwner: ReadonlyMap<
    Node,
    readonly MutableCallableValueResolution[]
  >,
): void {
  const all = [...new Set(resolutions)];
  const dependents = new Map<
    MutableCallableValueResolution,
    Set<MutableCallableValueResolution>
  >();
  for (const resolution of all) {
    resolution.forEachSynchronousDeclaration((declaration) => {
      for (const nested of callsByOwner.get(declaration) ?? []) {
        const selected = dependents.get(nested);
        if (selected === undefined) {
          dependents.set(nested, new Set([resolution]));
        } else {
          selected.add(resolution);
        }
      }
    });
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
  resolution.forEachSynchronousDeclaration((declaration) => {
    for (const nested of callsByOwner.get(declaration) ?? []) {
      mergeDependencyEvidence(resolution, nested);
    }
  });
}

export function sealResolution(
  resolution: MutableCallableValueResolution,
): CallableValueResolution {
  return resolution.seal();
}

export function sealResolutions(
  ...sources: readonly Iterable<MutableCallableValueResolution>[]
): void {
  const sealed = new Set<MutableCallableValueResolution>();
  for (const source of sources) {
    for (const resolution of source) {
      if (!sealed.has(resolution)) {
        resolution.seal();
        sealed.add(resolution);
      }
    }
  }
}

function mergeDependencyEvidence(
  target: MutableCallableValueResolution,
  source: MutableCallableValueResolution,
): boolean {
  return target.mergeDependencyEvidence(source);
}
