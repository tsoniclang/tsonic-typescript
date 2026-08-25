import type { Node, SourceFile } from "@tsonic/tsts";
import type { TargetSourceProgram } from "@tsonic/target-api/source";

import type { SourceIdentityResolver } from "../../occurrence.js";
import type { TargetProgramIndex } from "../../program-index.js";
import type {
  TypeScriptActiveCooperativeEffectProfile,
  TypeScriptInterfaceDispatchProfile,
} from "../../profile.js";
import {
  composeInvocationTransportContracts,
  type InvocationTransportContract,
} from "../../invocation-transport.js";
import type { LoweredValueContract } from "../../value-contract.js";
import type { TypeScriptPlanningObserver } from "../../planning-observer.js";
import {
  createProgramGeneratedNames,
  type ProgramGeneratedNames,
} from "../../generated-names.js";
import {
  classifyCooperativeEffectProgram,
  collectSettledCooperativeAwaits,
} from "./classification.js";
import {
  type CooperativeEffectCallUseClassification,
  collectCooperativeResultConsumerQueries,
  classifyCooperativeEffectCallUses,
} from "./classification/call-uses.js";
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
import { createCooperativeEffectPlanLifecycle } from "./lifecycle.js";
import {
  createCooperativeResultConsumption,
  type CooperativeResultConsumptionEvidence,
} from "../flow/return/result-consumption.js";
import { createReturnValueFlow } from "../flow/return/value.js";
import { collectReturnFlowQueries } from "../flow/return/queries.js";
import {
  createExactAggregateProjectionIndex,
} from "../flow/aggregate/projection.js";
import { createProviderInvocationFlow } from "../flow/provider/flow.js";
import { createSourceInvocationFlow } from "../flow/source-invocation/flow.js";
import { createConditionalProviderEffectFlow } from "../flow/provider/conditional.js";
import { createExactInvocationInputIndex } from "../flow/invocation/inputs.js";
import {
  settleCooperativeEffectFlows,
} from "../flow/settlement/program.js";
import {
  createExactObjectPropertyProjectionIndex,
} from "../flow/object/projection.js";
import {
  type CooperativeEffectPlanSummary,
  summarizeCooperativeEffects,
} from "./summary.js";
import { connectCooperativeEffectDependency } from "../closure/dependency.js";
import {
  collectCallableFields,
  createCallableFieldBoundaryDependencies,
} from "../flow/storage/fields.js";
import {
  createClosedStorageOwnerAnalysis,
} from "../flow/storage/analysis.js";
import {
  composeStorageOwnerBoundaryDependencies,
  createStorageOwnerProfileBoundaryDependencies,
} from "../flow/storage/owner-boundaries.js";
import { collectInterfaceEffectContracts } from "../flow/interface/contracts.js";
import { createInterfaceStorageBoundaryDependencies } from "../flow/interface/storage-dependencies.js";
import {
  collectCooperativePromiseBoundaries,
  prepareCooperativePromiseBoundaries,
} from "./promise-boundaries.js";

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
  cooperativeEffects: TypeScriptActiveCooperativeEffectProfile = "closed-direct",
  planningObserver?: TypeScriptPlanningObserver,
  generatedNames?: ProgramGeneratedNames,
): CooperativeEffectPlan {
  const effectGeneratedNames = generatedNames ??
    createProgramGeneratedNames(source, program);
  const sourceInvocations = createSourceInvocationFlow(source, program);
  const candidates = collectCooperativeEffectCandidates(
    source,
    program,
    cooperativeEffects,
    sourceInvocations.bodyInspectionIsCertified,
  );
  const candidateDeclarations = new Set(candidates.keys());
  planningObserver?.("effect-candidates");
  const calls = collectCooperativeEffectCalls(
    source,
    program,
    candidates,
    sourceInvocations.bodyInspectionIsCertified,
  );
  const providerInvocations = createProviderInvocationFlow(
    source,
    program,
    sourceInvocations.bodyInspectionIsCertified,
  );
  const factOwnedTransports = composeInvocationTransportContracts([
    transports,
    providerInvocations.transport,
    sourceInvocations.transport,
  ]);
  planningObserver?.("effect-calls");
  const aggregateProjections = createExactAggregateProjectionIndex(
    source,
    program,
    sourceInvocations.bodyInspectionIsCertified,
  );
  const objectProjections = createExactObjectPropertyProjectionIndex(
    source,
    program,
    cooperativeEffects,
    sourceInvocations.bodyInspectionIsCertified,
  );
  planningObserver?.("effect-projections");
  const directInvocationInputs = createExactInvocationInputIndex(
    source,
    program,
    aggregateProjections,
    cooperativeEffects,
    sourceInvocations.bodyInspectionIsCertified,
  );
  planningObserver?.("effect-invocation-inputs");
  const storageOwners = createClosedStorageOwnerAnalysis(
    source,
    program,
    sourceInvocations.bodyInspectionIsCertified,
    sourceInvocations.implementationsFor,
  );
  const callableFields = collectCallableFields(source, program, storageOwners);
  const profileStorageDependencies =
    createStorageOwnerProfileBoundaryDependencies(source, cooperativeEffects);
  const sourceStorageDependencies = Object.freeze({
    allowsInvocation(invocation: Node): boolean {
      return sourceInvocations.invocationHasCertifiedImplementation(invocation);
    },
    allowsContextualValue(): boolean {
      return false;
    },
    allowsModuleForwardingReference(): boolean {
      return false;
    },
  });
  const exactStorageDependencies = composeStorageOwnerBoundaryDependencies([
    profileStorageDependencies,
    sourceStorageDependencies,
  ]);
  const callableStorageDependencies = composeStorageOwnerBoundaryDependencies([
    exactStorageDependencies,
    createCallableFieldBoundaryDependencies(source, callableFields),
  ]);
  const interfaceStorageDependencies = interfaceDispatch === "declared-closed"
    ? createInterfaceStorageBoundaryDependencies(
        source,
        new Set(collectInterfaceEffectContracts(
          source,
          program,
          sourceInvocations.bodyInspectionIsCertified,
        ).map(
          (contract) => contract.owner,
        )),
      )
    : undefined;
  const settlement = settleCooperativeEffectFlows(Object.freeze({
    source,
    program,
    candidates,
    callableExpressionQueries: Object.freeze(
      providerInvocations.conditionalCalls.flatMap((call) =>
        call.callableExpressions ?? []
      ),
    ),
    sourceIdentityFor,
    interfaceDispatch,
    cooperativeEffects,
    sourceInvocations,
    ...(factOwnedTransports === undefined ? {} : { factOwnedTransports }),
    directInvocationInputs,
    aggregateProjections,
    objectProjections,
    storageOwners,
    callableFields,
    ...(exactStorageDependencies === undefined
      ? {}
      : { exactStorageDependencies }),
    ...(callableStorageDependencies === undefined
      ? {}
      : { callableStorageDependencies }),
    ...(interfaceStorageDependencies === undefined
      ? {}
      : { interfaceStorageDependencies }),
    ...(planningObserver === undefined ? {} : { planningObserver }),
  }));
  const {
    interfaces,
    indirectInvocations,
    valueFlow,
    completeTransports,
    exactCallImplementations,
  } = settlement;
  interfaces.connectCandidateDependencies();
  const invocationInputs = indirectInvocations.invocationInputs;
  planningObserver?.("effect-callable-flow");
  const conditionalProviders = createConditionalProviderEffectFlow(
    providerInvocations,
    valueFlow,
  );
  connectSignatureFamilies(candidates, valueFlow.signatureFamilies);
  let resultConsumptionEvidence: CooperativeResultConsumptionEvidence;
  let callUses: CooperativeEffectCallUseClassification;
  {
    const resultConsumerQueries = collectCooperativeResultConsumerQueries(
      source,
      candidates,
      calls,
      interfaces,
      valueFlow,
      conditionalProviders,
    );
    const resultConsumption = createCooperativeResultConsumption(
      source,
      program,
      resultConsumerQueries,
      candidateDeclarations,
      invocationInputs,
      aggregateProjections,
      objectProjections,
      storageOwners,
      exactCallImplementations,
      completeTransports,
      valueFlow.allowsCallableReference,
      sourceInvocations.bodyInspectionIsCertified,
      cooperativeEffects,
    );
    callUses = classifyCooperativeEffectCallUses(
      source,
      candidates,
      calls,
      interfaces,
      valueFlow,
      conditionalProviders,
      resultConsumption.returnedCallHasClosedConsumers,
    );
    resultConsumptionEvidence = resultConsumption.evidence();
  }
  planningObserver?.("effect-result-consumption");
  const promiseBoundaryNames = prepareCooperativePromiseBoundaries(
    source,
    callUses.promiseCalls,
    calls,
    interfaces,
    valueFlow,
    candidates,
    effectGeneratedNames,
    cooperativeEffects,
  );
  const returnQueries = collectReturnFlowQueries(
    source,
    program,
    candidateDeclarations,
    valueFlow,
  );
  const returnFlow = createReturnValueFlow(
    source,
    program,
    aggregateProjections,
    candidateDeclarations,
    (call) => calls.get(call)?.declaration,
    invocationInputs,
    objectProjections,
    storageOwners,
    returnQueries,
    loweredValues,
    (call) => exactCallImplementations(call) ?? noDependencies,
    completeTransports,
    valueFlow.allowsCallableReference,
    cooperativeEffects,
    planningObserver,
    sourceInvocations.bodyInspectionIsCertified,
  );
  planningObserver?.("effect-return-flow");
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
    conditionalProviders,
    conditionalSettlements,
    sourceInvocations.bodyInspectionIsCertified,
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
    conditionalProviders,
    optimized,
    sourceInvocations.bodyInspectionIsCertified,
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
  const settledProviderCalls = conditionalProviders.settledCalls(optimized)
    .filter((provider) => !callUses.providerPromiseCalls.has(provider.call));
  const promiseBoundaries = collectCooperativePromiseBoundaries(
    callUses.promiseCalls,
    calls,
    interfaces,
    valueFlow,
    candidates,
    optimized,
    promiseBoundaryNames,
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
    settledProviderCalls,
    promiseBoundaries,
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
    resultConsumptionEvidence,
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
