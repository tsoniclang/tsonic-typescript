import type { Node, SourceFile } from "@tsonic/tsts";
import type { TargetSourceProgram } from "@tsonic/target-api/source";

import type { SourceIdentityResolver } from "../../occurrence.js";
import type { TargetProgramIndex } from "../../program-index.js";
import type { TypeScriptInterfaceDispatchProfile } from "../../profile.js";
import {
  composeInvocationTransportContracts,
  type InvocationTransportContract,
} from "../../invocation-transport.js";
import type { LoweredValueContract } from "../../value-contract.js";
import type { TypeScriptPlanningObserver } from "../../planning-observer.js";
import {
  classifyCooperativeEffectCallUses,
  classifyCooperativeEffectProgram,
  collectSettledCooperativeAwaits,
} from "./classification.js";
import { propagateEffectBlockers } from "../closure/blocker-propagation.js";
import {
  collectCooperativeEffectCalls,
  collectCooperativeEffectCandidates,
  type CooperativeEffectCandidate,
} from "../inventory/candidates.js";
import { attributeCooperativeAwaits } from "../inventory/awaits.js";
import {
  decideCooperativeEffectRetentions,
} from "../closure/retention.js";
import {
  createCooperativeEffectFilePlans,
  type CooperativeEffectFilePlan,
} from "./file-plan.js";
import { createDeclaredInterfaceDispatch } from "../flow/interface/dispatch.js";
import { createCooperativeEffectPlanLifecycle } from "./lifecycle.js";
import { createCooperativeResultConsumption } from "../flow/return/result-consumption.js";
import { createReturnValueFlow } from "../flow/return/value.js";
import { createCallableValueFlow } from "../flow/callable/value-flow.js";
import { createExactAggregateProjectionIndex } from "../flow/aggregate/projection.js";
import { createProviderInvocationTransport } from "../flow/provider/transport.js";
import { createExactInvocationInputIndex } from "../flow/invocation/inputs.js";
import {
  createExactIndirectInvocationAnalysis,
} from "../flow/invocation/indirect.js";
import { createExactObjectPropertyProjectionIndex } from "../flow/object/projection.js";
import {
  type CooperativeEffectPlanSummary,
  summarizeCooperativeEffects,
} from "./summary.js";
import { connectCooperativeEffectDependency } from "../closure/dependency.js";
import { collectCallableFields } from "../flow/storage/fields.js";

export type { CooperativeEffectFilePlan } from "./file-plan.js";

export interface CooperativeEffectResultProjection {
  projectedReturnTypeFor(target: Node): Node | undefined;
}

export interface CooperativeEffectPlan extends CooperativeEffectResultProjection {
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
  transports?: InvocationTransportContract,
  interfaceDispatch: TypeScriptInterfaceDispatchProfile = "open-structural",
  planningObserver?: TypeScriptPlanningObserver,
): CooperativeEffectPlan {
  const candidates = collectCooperativeEffectCandidates(source, program);
  planningObserver?.("effect-candidates");
  const calls = collectCooperativeEffectCalls(source, program, candidates);
  const factOwnedTransports = composeInvocationTransportContracts([
    transports,
    createProviderInvocationTransport(source, program),
  ]);
  planningObserver?.("effect-calls");
  const aggregateProjections = createExactAggregateProjectionIndex(
    source,
    program,
  );
  const objectProjections = createExactObjectPropertyProjectionIndex(
    source,
    program,
  );
  planningObserver?.("effect-projections");
  const directInvocationInputs = createExactInvocationInputIndex(
    source,
    program,
    aggregateProjections,
  );
  planningObserver?.("effect-invocation-inputs");
  const callableFields = collectCallableFields(source, program);
  const preliminaryIndirectInvocations = createExactIndirectInvocationAnalysis(
    source,
    program,
    directInvocationInputs,
    aggregateProjections,
    objectProjections,
    factOwnedTransports,
    undefined,
    planningObserver,
    callableFields,
  );
  planningObserver?.("effect-indirect-invocations");
  const interfaces = createDeclaredInterfaceDispatch(
    source,
    program,
    candidates,
    interfaceDispatch,
    factOwnedTransports,
    sourceIdentityFor,
    Object.freeze({
      invocationInputs: preliminaryIndirectInvocations.invocationInputs,
      exactCallImplementations:
        preliminaryIndirectInvocations.implementationsFor,
      callableReferenceIsClosed:
        preliminaryIndirectInvocations.allowsCallableReference,
      aggregateProjections,
      objectProjections,
    }),
  );
  planningObserver?.("effect-interface-dispatch");
  const completeTransports = composeInvocationTransportContracts([
    factOwnedTransports,
    interfaces.invocationTransports,
  ]);
  const indirectInvocations = interfaceDispatch === "open-structural"
    ? preliminaryIndirectInvocations
    : createExactIndirectInvocationAnalysis(
        source,
        program,
        interfaces.invocationInputs,
        aggregateProjections,
        objectProjections,
        completeTransports,
        (call) => interfaces.calls.get(call)?.implementations,
        planningObserver,
        callableFields,
      );
  const invocationInputs = indirectInvocations.invocationInputs;
  const bootstrapCallImplementations = (
    call: Node,
  ): readonly Node[] | undefined => {
    const selected = new Set([
      ...(indirectInvocations.implementationsFor(call) ?? noDependencies),
      ...(interfaces.calls.get(call)?.implementations ?? noDependencies),
    ]);
    return selected.size === 0 ? undefined : Object.freeze([...selected]);
  };
  const valueFlow = createCallableValueFlow(
    source,
    program,
    new Set(candidates.keys()),
    aggregateProjections,
    completeTransports,
    bootstrapCallImplementations,
    invocationInputs,
    (declaration) =>
      interfaces.declarations.get(declaration)?.implementations,
    objectProjections,
    indirectInvocations.allowsCallableReference,
    callableFields,
    planningObserver,
  );
  planningObserver?.("effect-callable-flow");
  connectSignatureFamilies(candidates, valueFlow.signatureFamilies);
  const exactCallImplementations = (call: Node): readonly Node[] | undefined => {
    const resolution = valueFlow.resolutionFor(call);
    const selected = new Set([
      ...(resolution?.closed === true
        ? resolution.dependencyNodes()
        : noDependencies),
      ...(resolution?.closed === true
        ? resolution.synchronousDeclarationNodes()
        : noDependencies),
      ...(interfaces.calls.get(call)?.implementations ?? noDependencies),
    ]);
    return selected.size === 0 ? undefined : Object.freeze([...selected]);
  };
  const returnFlow = createReturnValueFlow(
    source,
    program,
    aggregateProjections,
    new Set(candidates.keys()),
    (call) => calls.get(call)?.declaration,
    invocationInputs,
    objectProjections,
    loweredValues,
    (call) => exactCallImplementations(call) ?? noDependencies,
    completeTransports,
    valueFlow.allowsCallableReference,
    planningObserver,
  );
  planningObserver?.("effect-return-flow");
  const resultConsumption = createCooperativeResultConsumption(
    source,
    program,
    new Set(candidates.keys()),
    invocationInputs,
    aggregateProjections,
    objectProjections,
    exactCallImplementations,
    completeTransports,
    valueFlow.allowsCallableReference,
  );
  planningObserver?.("effect-result-consumption");
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
  planningObserver?.("effect-classification");
  const propagation = propagateEffectBlockers(candidates.values());
  planningObserver?.("effect-propagation");
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
  const awaitAttribution = attributeCooperativeAwaits(
    source,
    program,
    candidates,
    retentions,
    awaits,
    propagation,
    sourceIdentityFor,
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
  planningObserver?.("effect-file-plans");
  const summary = summarizeCooperativeEffects(
    source,
    sourceIdentityFor,
    candidateList,
    retentions,
    optimized.size,
    awaits.size,
    propagation.evidence,
    awaitAttribution,
    resultConsumption.evidence(),
    interfaces.evidence(optimized, retentions),
  );
  planningObserver?.("effect-summary");
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
          connectCooperativeEffectDependency(
            candidate,
            dependency,
            "implementation",
            related,
          );
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
