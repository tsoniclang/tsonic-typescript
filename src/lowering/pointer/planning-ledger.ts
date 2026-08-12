export type PointerPlanningPhase =
  | "flow-census"
  | "direct-family"
  | "representation"
  | "projection"
  | "evidence";

export type PointerPlanningOperations = Readonly<
  Record<PointerPlanningPhase, number>
>;

export class PointerPlanningLedger {
  readonly #operations: Record<PointerPlanningPhase, number> = {
    "flow-census": 0,
    "direct-family": 0,
    representation: 0,
    projection: 0,
    evidence: 0,
  };

  record(phase: PointerPlanningPhase, count = 1): void {
    if (!Number.isSafeInteger(count) || count < 0) {
      throw new Error("pointer planning work must be a non-negative safe integer");
    }
    this.#operations[phase] += count;
  }

  snapshot(): PointerPlanningOperations {
    return Object.freeze({ ...this.#operations });
  }
}

export function totalPointerPlanningOperations(
  operations: PointerPlanningOperations,
): number {
  return Object.values(operations).reduce((total, count) => total + count, 0);
}
