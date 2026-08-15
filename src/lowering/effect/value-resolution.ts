import type { Node } from "@tsonic/tsts";

export interface CallableValueResolution {
  readonly dependencies: ReadonlySet<Node>;
  readonly synchronousDeclarations: ReadonlySet<Node>;
  readonly closed: boolean;
}

export class MutableCallableValueResolution {
  #dependencies: Set<Node> | undefined;
  #synchronousDeclarations: Set<Node> | undefined;
  #closed: boolean;

  private constructor(
    dependencies: Set<Node>,
    synchronousDeclarations: Set<Node>,
    closed: boolean,
  ) {
    this.#dependencies = dependencies;
    this.#synchronousDeclarations = synchronousDeclarations;
    this.#closed = closed;
  }

  public static empty(): MutableCallableValueResolution {
    return new MutableCallableValueResolution(new Set(), new Set(), true);
  }

  public static unresolved(): MutableCallableValueResolution {
    return new MutableCallableValueResolution(new Set(), new Set(), false);
  }

  public static withDependency(
    dependency: Node,
  ): MutableCallableValueResolution {
    return new MutableCallableValueResolution(
      new Set([dependency]),
      new Set(),
      true,
    );
  }

  public static withSynchronousDeclaration(
    declaration: Node,
  ): MutableCallableValueResolution {
    return new MutableCallableValueResolution(
      new Set(),
      new Set([declaration]),
      true,
    );
  }

  public isClosed(): boolean {
    this.#assertMutable();
    return this.#closed;
  }

  public hasDependencies(): boolean {
    return this.#mutableDependencies().size !== 0;
  }

  public markUnclosed(): void {
    this.#assertMutable();
    this.#closed = false;
  }

  public merge(source: MutableCallableValueResolution): void {
    const dependencies = this.#mutableDependencies();
    const synchronousDeclarations = this.#mutableSynchronousDeclarations();
    this.#closed &&= source.isClosed();
    source.forEachDependency((dependency) => dependencies.add(dependency));
    source.forEachSynchronousDeclaration((declaration) =>
      synchronousDeclarations.add(declaration)
    );
  }

  public mergeDependencyEvidence(
    source: MutableCallableValueResolution,
  ): boolean {
    const dependencies = this.#mutableDependencies();
    let changed = false;
    if (this.#closed && !source.isClosed()) {
      this.#closed = false;
      changed = true;
    }
    source.forEachDependency((dependency) => {
      if (!dependencies.has(dependency)) {
        dependencies.add(dependency);
        changed = true;
      }
    });
    return changed;
  }

  public forEachDependency(visitor: (dependency: Node) => void): void {
    for (const dependency of this.#mutableDependencies()) {
      visitor(dependency);
    }
  }

  public forEachSynchronousDeclaration(
    visitor: (declaration: Node) => void,
  ): void {
    for (const declaration of this.#mutableSynchronousDeclarations()) {
      visitor(declaration);
    }
  }

  public seal(): CallableValueResolution {
    const dependencies = this.#mutableDependencies();
    const synchronousDeclarations = this.#mutableSynchronousDeclarations();
    this.#dependencies = undefined;
    this.#synchronousDeclarations = undefined;
    return Object.freeze({
      dependencies: immutableNodeSet(dependencies),
      synchronousDeclarations: immutableNodeSet(synchronousDeclarations),
      closed: this.#closed,
    });
  }

  #mutableDependencies(): Set<Node> {
    const dependencies = this.#dependencies;
    if (dependencies === undefined) {
      throw new Error("callable value resolution is already sealed");
    }
    return dependencies;
  }

  #mutableSynchronousDeclarations(): Set<Node> {
    const declarations = this.#synchronousDeclarations;
    if (declarations === undefined) {
      throw new Error("callable value resolution is already sealed");
    }
    return declarations;
  }

  #assertMutable(): void {
    if (
      this.#dependencies === undefined ||
      this.#synchronousDeclarations === undefined
    ) {
      throw new Error("callable value resolution is already sealed");
    }
  }
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
  const all = [...resolutions];
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

function immutableNodeSet(values: Set<Node>): ReadonlySet<Node> {
  return values.size === 0 ? emptyImmutableNodeSet : new ImmutableNodeSet(values);
}

class ImmutableNodeSet implements ReadonlySet<Node> {
  readonly #single: Node | undefined;
  readonly #values: Set<Node> | undefined;

  public constructor(values: Set<Node>) {
    if (values.size === 1) {
      this.#single = values.values().next().value;
      this.#values = undefined;
    } else {
      this.#single = undefined;
      this.#values = values;
    }
    Object.freeze(this);
  }

  public get size(): number {
    return this.#single === undefined ? this.#values?.size ?? 0 : 1;
  }

  public get [Symbol.toStringTag](): string {
    return "Set";
  }

  public has(value: Node): boolean {
    return this.#single === undefined
      ? this.#values?.has(value) ?? false
      : this.#single === value;
  }

  public *entries(): SetIterator<[Node, Node]> {
    if (this.#single !== undefined) {
      yield [this.#single, this.#single];
      return;
    }
    yield* this.#values?.entries() ?? [];
  }

  public keys(): SetIterator<Node> {
    return this.values();
  }

  public *values(): SetIterator<Node> {
    if (this.#single !== undefined) {
      yield this.#single;
      return;
    }
    yield* this.#values?.values() ?? [];
  }

  public [Symbol.iterator](): SetIterator<Node> {
    return this.values();
  }

  public forEach(
    callback: (value: Node, value2: Node, set: ReadonlySet<Node>) => void,
    thisArg?: unknown,
  ): void {
    for (const value of this) {
      callback.call(thisArg, value, value, this);
    }
  }
}

const emptyImmutableNodeSet: ReadonlySet<Node> = new ImmutableNodeSet(
  new Set(),
);

function mergeDependencyEvidence(
  target: MutableCallableValueResolution,
  source: MutableCallableValueResolution,
): boolean {
  return target.mergeDependencyEvidence(source);
}
