import type { Node } from "@tsonic/tsts";
import type { TargetSourceProgram } from "@tsonic/target-api/source";
import { KindCallExpression } from "@tsonic/tsts/target-ast";
import type { TargetProgramIndex } from "../../../program-index.js";
import type { TypeScriptPlanningObserver } from "../../../planning-observer.js";
import type { InvocationTransportContract } from "../../../invocation-transport.js";
import { callableHasOpenInvocationSurface } from "../../model/declaration-surface.js";
import type { ExactAggregateProjectionIndex } from "../aggregate/projection.js";
import {
  type ExactCallableBodyInspection,
  type ExactCallImplementations,
} from "../callable/result-inputs.js";
import type { ExactObjectPropertyProjectionIndex } from "../object/projection.js";
import {
  collectCallableFields,
  createCallableFieldBoundaryDependencies,
  type CallableFields,
} from "../storage/fields.js";
import { extendExactInvocationInputIndex } from "./implementation-inputs.js";
import type { ExactInvocationInputIndex } from "./inputs.js";
import { collectCallableProjectionCandidates } from "../callable/projection-candidates.js";
import { collectExactIndirectInvocationRound } from "./indirect/round.js";
import type {
  ExactIndirectCallableInvocation,
  ExactIndirectInvocationAnalysis,
  ExactIndirectInvocationRound,
} from "./indirect/model.js";
import { finalizeExactIndirectInvocationFacts } from "./indirect/finalization.js";
import type { ClosedStorageOwnerAnalysis } from "../storage/analysis.js";
import {
  composeStorageOwnerBoundaryDependencies,
  type StorageOwnerBoundaryDependencies,
} from "../storage/owner-boundaries.js";
import type { TypeScriptActiveCooperativeEffectProfile } from "../../../profile.js";

export type {
  ExactIndirectCallableInvocation,
  ExactIndirectInvocationAnalysis,
  ExactIndirectInvocationFacts,
} from "./indirect/model.js";

export type ExactIndirectInvocationBootstrap =
  | "none"
  | "declared-interface";
interface ExactIndirectInvocationDomain {
  readonly source: TargetSourceProgram;
  readonly program: TargetProgramIndex;
  readonly projections: ExactAggregateProjectionIndex;
  readonly objectProjections: ExactObjectPropertyProjectionIndex;
  readonly projectionCandidates: readonly Node[];
  readonly callableFields: CallableFields;
  readonly storageOwners?: ClosedStorageOwnerAnalysis;
  readonly boundaryDependencies?: StorageOwnerBoundaryDependencies;
  readonly bodyInspectionIsCertified?: ExactCallableBodyInspection;
  readonly cooperativeEffects: TypeScriptActiveCooperativeEffectProfile;
}

type ExactIndirectInvocationSettlementDirection = "expanding" | "contracting";
type CallableReferenceAdmission = "derived" | "universal";

interface SettledExactIndirectInvocationRound {
  readonly round: ExactIndirectInvocationRound;
  readonly invocationInputs: ExactInvocationInputIndex;
}

function emptyRound(): ExactIndirectInvocationRound {
  return Object.freeze({
    invocations: Object.freeze([]),
    callableReferences: Object.freeze(new Set<Node>()),
  });
}

export function createExactIndirectInvocationAnalysis(
  source: TargetSourceProgram,
  program: TargetProgramIndex,
  direct: ExactInvocationInputIndex,
  projections: ExactAggregateProjectionIndex,
  objectProjections: ExactObjectPropertyProjectionIndex,
  transports?: InvocationTransportContract,
  initialCallImplementations?: ExactCallImplementations,
  planningObserver?: TypeScriptPlanningObserver,
  callableFields?: CallableFields,
  storageOwners?: ClosedStorageOwnerAnalysis,
  boundaryDependencies?: StorageOwnerBoundaryDependencies,
  bootstrap: ExactIndirectInvocationBootstrap = "none",
  bootstrapStorageDependencies?: StorageOwnerBoundaryDependencies,
  bodyInspectionIsCertified?: ExactCallableBodyInspection,
  cooperativeEffects: TypeScriptActiveCooperativeEffectProfile = "closed-direct",
): ExactIndirectInvocationAnalysis {
  const selectedCallableFields = callableFields ??
    collectCallableFields(source, program);
  const stableBoundaryDependencies = composeStorageOwnerBoundaryDependencies([
    boundaryDependencies,
    createCallableFieldBoundaryDependencies(source, selectedCallableFields),
  ]);
  const domain: ExactIndirectInvocationDomain = Object.freeze({
    source,
    program,
    projections,
    objectProjections,
    projectionCandidates: collectCallableProjectionCandidates(
      source,
      program,
      planningObserver,
      bodyInspectionIsCertified,
    ),
    callableFields: selectedCallableFields,
    ...(storageOwners === undefined ? {} : { storageOwners }),
    ...(stableBoundaryDependencies === undefined
      ? {}
      : { boundaryDependencies: stableBoundaryDependencies }),
    ...(bodyInspectionIsCertified === undefined
      ? {}
      : { bodyInspectionIsCertified }),
    cooperativeEffects,
  });
  if (bootstrap === "declared-interface") {
    const boundaryDependencies = composeStorageOwnerBoundaryDependencies([
      domain.boundaryDependencies,
      bootstrapStorageDependencies,
    ]);
    const seed = collectExactIndirectInvocationRound(
      source,
      program,
      direct,
      projections,
      objectProjections,
      transports,
      initialCallImplementations,
      () => true,
      domain.projectionCandidates,
      planningObserver,
      domain.callableFields,
      domain.storageOwners,
      boundaryDependencies,
      domain.bodyInspectionIsCertified,
      domain.cooperativeEffects,
    );
    return createAnalysis(
      domain,
      seed,
      extendInputs(source, direct, seed.invocations, projections),
    );
  }
  return settleExactIndirectInvocationAnalysis(
    domain,
    direct,
    transports,
    initialCallImplementations,
    planningObserver,
    emptyRound(),
  );
}

function settleExactIndirectInvocationAnalysis(
  domain: ExactIndirectInvocationDomain,
  direct: ExactInvocationInputIndex,
  transports: InvocationTransportContract | undefined,
  initialCallImplementations: ExactCallImplementations | undefined,
  planningObserver: TypeScriptPlanningObserver | undefined,
  seed: ExactIndirectInvocationRound,
  direction: ExactIndirectInvocationSettlementDirection = "expanding",
): ExactIndirectInvocationAnalysis {
  const settled = settleExactIndirectInvocationRound(
    domain,
    direct,
    transports,
    initialCallImplementations,
    planningObserver,
    seed,
    direction,
    "derived",
  );
  return createAnalysis(domain, settled.round, settled.invocationInputs);
}

function settleExactIndirectInvocationRound(
  domain: ExactIndirectInvocationDomain,
  direct: ExactInvocationInputIndex,
  transports: InvocationTransportContract | undefined,
  initialCallImplementations: ExactCallImplementations | undefined,
  planningObserver: TypeScriptPlanningObserver | undefined,
  seed: ExactIndirectInvocationRound,
  direction: ExactIndirectInvocationSettlementDirection,
  referenceAdmission: CallableReferenceAdmission,
): SettledExactIndirectInvocationRound {
  const { source, program, projections, objectProjections } = domain;
  let invocationInputs = extendInputs(
    source,
    direct,
    seed.invocations,
    projections,
  );
  let previous = seed;
  let previousFactCount = roundFactCount(previous);
  const maximumFactCount = exactIndirectInvocationFactDomainSize(program);
  for (;;) {
    const current = collectExactIndirectInvocationRound(
      source,
      program,
      invocationInputs,
      projections,
      objectProjections,
      transports,
      composeImplementations(
        initialCallImplementations,
        implementationsFor(previous.invocations),
      ),
      referenceAdmission === "universal"
        ? () => true
        : (reference) => previous.callableReferences.has(reference),
      domain.projectionCandidates,
      planningObserver,
      domain.callableFields,
      domain.storageOwners,
      domain.boundaryDependencies,
      domain.bodyInspectionIsCertified,
      domain.cooperativeEffects,
    );
    planningObserver?.("effect-indirect-round", {
      calls: current.invocations.length,
      references: current.callableReferences.size,
    });
    if (sameRound(previous, current)) {
      return Object.freeze({ round: current, invocationInputs });
    }
    const monotonic = direction === "expanding"
      ? roundRefines(previous, current)
      : roundRefines(current, previous);
    if (!monotonic) {
      throw new Error(
        "exact indirect invocation settlement is not monotonic",
      );
    }
    const currentFactCount = roundFactCount(current);
    if (
      (direction === "expanding"
        ? currentFactCount <= previousFactCount
        : currentFactCount >= previousFactCount) ||
      currentFactCount > maximumFactCount
    ) {
      throw new Error(
        "exact indirect invocation settlement exceeded its finite domain",
      );
    }
    previousFactCount = currentFactCount;
    previous = current;
    invocationInputs = extendInputs(
      source,
      direct,
      current.invocations,
      projections,
    );
  }
}

function composeImplementations(
  left: ExactCallImplementations | undefined,
  right: ExactCallImplementations,
): ExactCallImplementations {
  return (call) => {
    const leftImplementations = left?.(call);
    const rightImplementations = right(call);
    if (
      leftImplementations === undefined &&
      rightImplementations === undefined
    ) {
      return undefined;
    }
    const selected = new Set([
      ...(leftImplementations ?? []),
      ...(rightImplementations ?? []),
    ]);
    return Object.freeze([...selected]);
  };
}

function createAnalysis(
  domain: ExactIndirectInvocationDomain,
  round: ExactIndirectInvocationRound,
  invocationInputs: ExactInvocationInputIndex,
): ExactIndirectInvocationAnalysis {
  const implementations = new Map(round.invocations.map((invocation) => [
    invocation.call,
    invocation.implementations,
  ]));
  const callableReferences = new Set(
    [...round.callableReferences].filter((reference) =>
      !callableHasOpenInvocationSurface(domain.source, reference)
    ),
  );
  const facts = finalizeExactIndirectInvocationFacts(
    invocationInputs,
    implementations,
    callableReferences,
  );
  return Object.freeze({
    invocationInputs: facts.invocationInputs,
    implementationsFor: facts.implementationsFor,
    allowsCallableReference: facts.allowsCallableReference,
    finalize() {
      return facts;
    },
    refine(
      refinedInputs: ExactInvocationInputIndex,
      transports: InvocationTransportContract | undefined,
      callImplementations: ExactCallImplementations | undefined,
      planningObserver?: TypeScriptPlanningObserver,
    ): ExactIndirectInvocationAnalysis {
      const saturatedUpperBound = settleExactIndirectInvocationRound(
        domain,
        refinedInputs,
        transports,
        callImplementations,
        planningObserver,
        emptyRound(),
        "expanding",
        "universal",
      ).round;
      return settleExactIndirectInvocationAnalysis(
        domain,
        refinedInputs,
        transports,
        callImplementations,
        planningObserver,
        saturatedUpperBound,
        "contracting",
      );
    },
  });
}

function implementationsFor(
  invocations: readonly ExactIndirectCallableInvocation[],
): ExactCallImplementations {
  const implementations = new Map(invocations.map((invocation) => [
    invocation.call,
    invocation.implementations,
  ]));
  return (call) => implementations.get(call);
}

function extendInputs(
  source: TargetSourceProgram,
  direct: ExactInvocationInputIndex,
  invocations: readonly ExactIndirectCallableInvocation[],
  projections: ExactAggregateProjectionIndex,
): ExactInvocationInputIndex {
  return extendExactInvocationInputIndex(
    source,
    direct,
    invocations.map(({ call, implementations }) => Object.freeze({
      calls: Object.freeze([call]),
      implementations,
    })),
    projections,
  );
}

function sameInvocations(
  left: readonly ExactIndirectCallableInvocation[],
  right: readonly ExactIndirectCallableInvocation[],
): boolean {
  if (left.length !== right.length) {
    return false;
  }
  const leftByCall = new Map(left.map((entry) => [
    entry.call,
    new Set(entry.implementations),
  ]));
  return right.every((entry) => {
    const selected = leftByCall.get(entry.call);
    return selected !== undefined &&
      selected.size === entry.implementations.length &&
      entry.implementations.every((implementation) => selected.has(implementation));
  });
}

function sameRound(
  left: ExactIndirectInvocationRound,
  right: ExactIndirectInvocationRound,
): boolean {
  return sameInvocations(left.invocations, right.invocations) &&
    left.callableReferences.size === right.callableReferences.size &&
    [...left.callableReferences].every((reference) =>
      right.callableReferences.has(reference)
    );
}

function roundRefines(
  previous: ExactIndirectInvocationRound,
  current: ExactIndirectInvocationRound,
): boolean {
  if (
    [...previous.callableReferences].some((reference) =>
      !current.callableReferences.has(reference)
    )
  ) {
    return false;
  }
  const currentByCall = new Map(current.invocations.map((entry) => [
    entry.call,
    new Set(entry.implementations),
  ]));
  return previous.invocations.every((entry) => {
    const selected = currentByCall.get(entry.call);
    return selected !== undefined &&
      entry.implementations.every((implementation) =>
        selected.has(implementation)
      );
  });
}

function roundFactCount(round: ExactIndirectInvocationRound): number {
  return round.callableReferences.size + round.invocations.reduce(
    (total, entry) => total + 1 + entry.implementations.length,
    0,
  );
}

function exactIndirectInvocationFactDomainSize(
  program: TargetProgramIndex,
): number {
  const calls = program.nodesOfKind(KindCallExpression).length;
  const nodes = program.nodes.length;
  const size = nodes + calls * (nodes + 1);
  if (!Number.isSafeInteger(size)) {
    throw new Error("exact indirect invocation finite domain is too large");
  }
  return size;
}

export function collectExactIndirectCallableInvocations(
  source: TargetSourceProgram,
  program: TargetProgramIndex,
  direct: ExactInvocationInputIndex,
  projections: ExactAggregateProjectionIndex,
  objectProjections: ExactObjectPropertyProjectionIndex,
  transports?: InvocationTransportContract,
  exactCallImplementations?: ExactCallImplementations,
  cooperativeEffects: TypeScriptActiveCooperativeEffectProfile = "closed-direct",
  bodyInspectionIsCertified?: ExactCallableBodyInspection,
): readonly ExactIndirectCallableInvocation[] {
  const projectionCandidates = collectCallableProjectionCandidates(
    source,
    program,
    undefined,
    bodyInspectionIsCertified,
  );
  return collectExactIndirectInvocationRound(
    source,
    program,
    direct,
    projections,
    objectProjections,
    transports,
    exactCallImplementations,
    undefined,
    projectionCandidates,
    undefined,
    undefined,
    undefined,
    undefined,
    bodyInspectionIsCertified,
    cooperativeEffects,
  ).invocations;
}
