import type {
  CooperativeEffectFallbackReason,
} from "./retention.js";

export interface EffectDependencyVertex {
  readonly dependencies: ReadonlySet<EffectDependencyVertex>;
  readonly blockers: Set<CooperativeEffectFallbackReason>;
}

export interface EffectPropagationEvidence {
  readonly vertices: number;
  readonly edges: number;
  readonly work: number;
}

export function propagateEffectBlockers(
  vertices: Iterable<EffectDependencyVertex>,
): EffectPropagationEvidence {
  const all = [...vertices];
  const dependents = new Map<EffectDependencyVertex, EffectDependencyVertex[]>();
  let edges = 0;
  let work = all.length;
  for (const vertex of all) {
    for (const dependency of vertex.dependencies) {
      edges += 1;
      work += 1;
      const existing = dependents.get(dependency);
      if (existing === undefined) {
        dependents.set(dependency, [vertex]);
      } else {
        existing.push(vertex);
      }
    }
  }
  const pending = all.filter((vertex) => vertex.blockers.size !== 0);
  for (let index = 0; index < pending.length; index += 1) {
    const blocked = pending[index];
    if (blocked === undefined) {
      continue;
    }
    for (const dependent of dependents.get(blocked) ?? []) {
      work += 1;
      let changed = false;
      for (const reason of blocked.blockers) {
        if (!dependent.blockers.has(reason)) {
          dependent.blockers.add(reason);
          changed = true;
        }
      }
      if (changed) {
        pending.push(dependent);
      }
    }
  }
  return Object.freeze({ vertices: all.length, edges, work });
}
