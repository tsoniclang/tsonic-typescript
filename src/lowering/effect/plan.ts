import type { Node, SourceFile } from "@tsonic/tsts";
import type { TargetSourceProgram } from "@tsonic/target-api";

import type { SourceIdentityResolver } from "../occurrence.js";
import type { TargetProgramIndex } from "../program-index.js";
import type { TypeScriptInterfaceDispatchProfile } from "../profile.js";
import type { StorageOwnerTransportContract } from "../storage-owner-transport.js";
import type { LoweredValueContract } from "../value-contract.js";
import {
  classifyCooperativeEffectCallUses,
  classifyCooperativeEffectProgram,
  collectSettledCooperativeAwaits,
} from "./analysis.js";
import { propagateEffectBlockers } from "./blocker-propagation.js";
import {
  collectCooperativeEffectCalls,
  collectCooperativeEffectCandidates,
  type CooperativeEffectCandidate,
} from "./candidate-inventory.js";
import {
  decideCooperativeEffectRetentions,
  type CooperativeEffectPlanSummary,
  summarizeCooperativeEffects,
} from "./fallback.js";
import {
  createCooperativeEffectFilePlans,
  type CooperativeEffectFilePlan,
} from "./file-plan.js";
import { createDeclaredInterfaceDispatch } from "./interface-dispatch.js";
import { createCooperativeEffectPlanLifecycle } from "./lifecycle.js";
import { createCooperativeResultConsumption } from "./result-consumption.js";
import { createReturnValueFlow } from "./return-value.js";
import { createCallableValueFlow } from "./value-flow.js";

export type { CooperativeEffectFilePlan } from "./file-plan.js";

export interface CooperativeEffectPlan {
  readonly source: TargetSourceProgram;
  readonly summary: CooperativeEffectPlanSummary;
  begin(sourceFile: SourceFile): CooperativeEffectFilePlan;
  finishFile(sourceFile: SourceFile): void;
  finish(): void;
}

const noDependencies: readonly Node[] = Object.freeze([]);

export function createClosedCooperativeEffectPlan(
  source: TargetSourceProgram,
  program: TargetProgramIndex,
  sourceIdentityFor: SourceIdentityResolver,
  loweredValues?: LoweredValueContract,
  transports?: StorageOwnerTransportContract,
  interfaceDispatch: TypeScriptInterfaceDispatchProfile = "open-structural",
): CooperativeEffectPlan {
  const candidates = collectCooperativeEffectCandidates(source, program);
  const calls = collectCooperativeEffectCalls(source, program, candidates);
  const interfaces = createDeclaredInterfaceDispatch(
    source,
    program,
    candidates,
    interfaceDispatch,
  );
  const valueFlow = createCallableValueFlow(
    source,
    program,
    new Set(candidates.keys()),
    transports,
  );
  connectSignatureFamilies(candidates, valueFlow.signatureFamilies);
  const returnFlow = createReturnValueFlow(
    source,
    program,
    (call) => calls.get(call)?.declaration,
    loweredValues,
    (call) =>
      valueFlow.resolutionFor(call)?.dependencyNodes() ?? noDependencies,
    transports,
  );
  const resultConsumption = createCooperativeResultConsumption(
    source,
    program,
    new Set(candidates.keys()),
  );
  const conditionalSettlements = createConditionalSettlementOwner(
    candidates.keys(),
  );
  classifyCooperativeEffectProgram(
    source,
    program,
    candidates,
    calls,
    interfaces,
    valueFlow,
    returnFlow,
    conditionalSettlements,
  );
  classifyCooperativeEffectCallUses(
    source,
    candidates,
    calls,
    interfaces,
    valueFlow,
    resultConsumption.returnedCallHasClosedConsumers,
  );
  const propagation = propagateEffectBlockers(candidates.values());
  const candidateList = [...candidates.values()];
  const retentions = decideCooperativeEffectRetentions(candidateList);
  const optimized = new Set(
    candidateList
      .filter((candidate) => !retentions.has(candidate))
      .map((candidate) => candidate.declaration),
  );
  const awaits = collectSettledCooperativeAwaits(
    source,
    program,
    candidates,
    calls,
    interfaces,
    valueFlow,
    returnFlow,
    optimized,
  );
  const files = createCooperativeEffectFilePlans(
    source,
    candidates.values(),
    optimized,
    awaits,
    [
      ...valueFlow.settledReturnTypes(optimized),
      ...interfaces.settledReturnTypes(optimized),
    ],
  );
  const summary = summarizeCooperativeEffects(
    source,
    sourceIdentityFor,
    candidateList,
    retentions,
    optimized.size,
    awaits.size,
    propagation,
    resultConsumption.evidence(),
    interfaces.evidence(optimized),
  );
  return createCooperativeEffectPlanLifecycle(source, files, summary);
}

function connectSignatureFamilies(
  candidates: ReadonlyMap<Node, CooperativeEffectCandidate>,
  families: readonly (readonly Node[])[],
): void {
  for (const family of families) {
    for (const declaration of family) {
      const candidate = candidates.get(declaration);
      if (candidate === undefined) {
        continue;
      }
      for (const related of family) {
        const dependency = candidates.get(related);
        if (dependency !== undefined && dependency !== candidate) {
          candidate.dependencies.add(dependency);
        }
      }
    }
  }
}

interface ConditionalSettlementTrie {
  readonly next: Map<Node, ConditionalSettlementTrie>;
  value?: ReadonlySet<Node>;
}

function createConditionalSettlementOwner(
  candidates: Iterable<Node>,
): (dependencies: Iterable<Node>) => ReadonlySet<Node> | undefined {
  const order = new Map([...candidates].map((candidate, index) => [
    candidate,
    index,
  ]));
  const root: ConditionalSettlementTrie = { next: new Map() };
  return (dependencies) => {
    const unique = new Set(dependencies);
    if (unique.size === 0) {
      return undefined;
    }
    const selected = [...unique].sort((left, right) => {
      const leftOrder = order.get(left);
      const rightOrder = order.get(right);
      if (leftOrder === undefined || rightOrder === undefined) {
        throw new Error("conditional settlement references a non-candidate");
      }
      return leftOrder - rightOrder;
    });
    let current = root;
    for (const declaration of selected) {
      let next = current.next.get(declaration);
      if (next === undefined) {
        next = { next: new Map() };
        current.next.set(declaration, next);
      }
      current = next;
    }
    current.value ??= Object.freeze(new Set(selected));
    return current.value;
  };
}
