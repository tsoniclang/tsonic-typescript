export const typeScriptPlanningPhases = Object.freeze([
  "program-index",
  "generated-names",
  "pointer-flow",
  "scalar-flow",
  "effect-candidates",
  "effect-calls",
  "effect-projections",
  "effect-invocation-inputs",
  "effect-indirect-results",
  "effect-indirect-value-inputs",
  "effect-indirect-graph",
  "effect-indirect-resolution",
  "effect-indirect-round",
  "effect-indirect-invocations",
  "effect-interface-dispatch",
  "effect-callable-flow",
  "effect-return-flow",
  "effect-result-consumption",
  "effect-classification",
  "effect-propagation",
  "effect-file-plans",
  "effect-summary",
  "representation-flow",
  "source-plans",
] as const);

export type TypeScriptPlanningPhase = typeof typeScriptPlanningPhases[number];

export type TypeScriptPlanningObserver = (
  phase: TypeScriptPlanningPhase,
) => void;
