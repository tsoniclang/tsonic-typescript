export type PointerPlanningPhase =
  | "flow-census"
  | "direct-family"
  | "representation"
  | "projection"
  | "evidence";

export type PointerPlanningOperations = Readonly<
  Record<PointerPlanningPhase, number>
>;

export type PointerPlanningCandidateOwner =
  | "typed-fact-node"
  | "binding-type"
  | "function-result"
  | "unowned-type"
  | "callable-alias-declaration"
  | "callable-alias-reference"
  | "result-call"
  | "variable-initializer"
  | "pointer-reference"
  | "pointer-call"
  | "pointer-return"
  | "pointer-audit-reference";

export type PointerPlanningCandidateCounts = Readonly<
  Partial<Record<PointerPlanningCandidateOwner, number>>
>;

export class PointerPlanningLedger {
  readonly #operations: Record<PointerPlanningPhase, number> = {
    "flow-census": 0,
    "direct-family": 0,
    representation: 0,
    projection: 0,
    evidence: 0,
  };
  readonly #candidateCounts = new Map<PointerPlanningCandidateOwner, number>();

  record(phase: PointerPlanningPhase, count = 1): void {
    if (!Number.isSafeInteger(count) || count < 0) {
      throw new Error("pointer planning work must be a non-negative safe integer");
    }
    this.#operations[phase] += count;
  }

  *candidates<T>(
    phase: PointerPlanningPhase,
    owner: PointerPlanningCandidateOwner,
    values: Iterable<T>,
  ): Iterable<T> {
    for (const value of values) {
      this.record(phase);
      this.#candidateCounts.set(owner, (this.#candidateCounts.get(owner) ?? 0) + 1);
      yield value;
    }
  }

  assertCandidateCount(
    owner: PointerPlanningCandidateOwner,
    expected: number,
  ): void {
    const actual = this.#candidateCounts.get(owner) ?? 0;
    if (actual !== expected) {
      throw new Error(
        `pointer planning owner '${owner}' recorded ${actual} candidates, expected ${expected}`,
      );
    }
  }

  snapshot(): PointerPlanningOperations {
    return Object.freeze({ ...this.#operations });
  }

  candidateSnapshot(): PointerPlanningCandidateCounts {
    return Object.freeze(Object.fromEntries(this.#candidateCounts));
  }
}

export function totalPointerPlanningOperations(
  operations: PointerPlanningOperations,
): number {
  return Object.values(operations).reduce((total, count) => total + count, 0);
}
