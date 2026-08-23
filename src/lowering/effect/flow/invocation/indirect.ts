import type { Node } from "@tsonic/tsts";
import type { TargetSourceProgram } from "@tsonic/target-api/source";
import { KindCallExpression } from "@tsonic/tsts/target-ast";
import type { TargetProgramIndex } from "../../../program-index.js";
import type { TypeScriptPlanningObserver } from "../../../planning-observer.js";
import type { InvocationTransportContract } from "../../../invocation-transport.js";
import { callableHasOpenInvocationSurface } from "../../model/declaration-surface.js";
import type { ExactAggregateProjectionIndex } from "../aggregate/projection.js";
import {
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
): ExactIndirectInvocationAnalysis {
  const domain: ExactIndirectInvocationDomain = Object.freeze({
    source,
    program,
    projections,
    objectProjections,
    projectionCandidates: collectCallableProjectionCandidates(
      source,
      program,
      planningObserver,
    ),
    callableFields: callableFields ?? collectCallableFields(source, program),
    ...(storageOwners === undefined ? {} : { storageOwners }),
    ...(boundaryDependencies === undefined ? {} : { boundaryDependencies }),
  });
  if (bootstrap === "declared-interface") {
    const boundaryDependencies = composeStorageOwnerBoundaryDependencies([
      domain.boundaryDependencies,
      bootstrapStorageDependencies,
      createCallableFieldBoundaryDependencies(source, domain.callableFields),
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
): ExactIndirectInvocationAnalysis {
  const { source, program, projections, objectProjections } = domain;
  let invocationInputs = extendInputs(
    source,
    direct,
    seed.invocations,
    projections,
  );
  let previous = seed;
  const states = new Set<string>();
  const identities = new Map<Node, number>();
  states.add(roundState(previous, identities));
  const maximumRounds = program.nodesOfKind(KindCallExpression).length + 1;
  for (let round = 0; round <= maximumRounds; round += 1) {
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
      (reference) => previous.callableReferences.has(reference),
      domain.projectionCandidates,
      planningObserver,
      domain.callableFields,
      domain.storageOwners,
      domain.boundaryDependencies,
    );
    planningObserver?.("effect-indirect-round");
    if (sameRound(previous, current)) {
      return createAnalysis(domain, current, invocationInputs);
    }
    const state = roundState(current, identities);
    if (states.has(state)) {
      return createAnalysis(domain, emptyRound(), direct);
    }
    states.add(state);
    previous = current;
    invocationInputs = extendInputs(
      source,
      direct,
      current.invocations,
      projections,
    );
  }
  return createAnalysis(domain, emptyRound(), direct);
}

function composeImplementations(
  left: ExactCallImplementations | undefined,
  right: ExactCallImplementations,
): ExactCallImplementations {
  return (call) => {
    const selected = new Set([
      ...(left?.(call) ?? []),
      ...(right(call) ?? []),
    ]);
    return selected.size === 0 ? undefined : Object.freeze([...selected]);
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
      return settleExactIndirectInvocationAnalysis(
        domain,
        refinedInputs,
        transports,
        callImplementations,
        planningObserver,
        round,
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

function roundState(
  round: ExactIndirectInvocationRound,
  identities: Map<Node, number>,
): string {
  const references = [...round.callableReferences]
    .map((reference) => identityFor(reference, identities))
    .sort((left, right) => left - right);
  return `${invocationState(round.invocations, identities)}|${references.join(",")}`;
}

function invocationState(
  invocations: readonly ExactIndirectCallableInvocation[],
  identities: Map<Node, number>,
): string {
  return invocations.map((entry) => {
    const implementations = entry.implementations.map((implementation) =>
      identityFor(implementation, identities)
    )
      .sort((left, right) => left - right);
    return `${identityFor(entry.call, identities)}:${implementations.join(",")}`;
  }).sort().join(";");
}

function identityFor(node: Node, identities: Map<Node, number>): number {
  let identity = identities.get(node);
  if (identity === undefined) {
    identity = identities.size;
    identities.set(node, identity);
  }
  return identity;
}

export function collectExactIndirectCallableInvocations(
  source: TargetSourceProgram,
  program: TargetProgramIndex,
  direct: ExactInvocationInputIndex,
  projections: ExactAggregateProjectionIndex,
  objectProjections: ExactObjectPropertyProjectionIndex,
  transports?: InvocationTransportContract,
  exactCallImplementations?: ExactCallImplementations,
): readonly ExactIndirectCallableInvocation[] {
  const projectionCandidates = collectCallableProjectionCandidates(source, program);
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
  ).invocations;
}
