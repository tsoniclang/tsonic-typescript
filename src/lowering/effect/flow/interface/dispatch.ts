import type { Node } from "@tsonic/tsts";
import type { TargetSourceProgram } from "@tsonic/target-api/source";
import type { TargetProgramIndex } from "../../../program-index.js";
import type { InvocationTransportContract } from "../../../invocation-transport.js";
import type {
  TypeScriptActiveCooperativeEffectProfile,
  TypeScriptInterfaceDispatchProfile,
} from "../../../profile.js";
import type { TypeScriptPlanningObserver } from "../../../planning-observer.js";
import {
  compareOptimizationOccurrences,
  optimizationOccurrence,
  type OptimizationOccurrence,
  type SourceIdentityResolver,
} from "../../../occurrence.js";
import type { CallableReturnRewrite } from "../../model/callable-contract.js";
import type { CooperativeEffectCandidate } from "../../inventory/candidates.js";
import type { EffectProvenanceEdgeKind } from "../../provenance/model.js";
import { connectCooperativeEffectDependency } from "../../closure/dependency.js";
import {
  blockCooperativeEffect,
  cooperativeEffectFallbackReasons,
  type CooperativeEffectFallbackReason,
  type CooperativeEffectRetentionDecisions,
} from "../../closure/retention.js";
import {
  callableUsesSynchronousTransport,
} from "../../model/synchronous.js";
import {
  createInterfaceContractGraph,
  type InterfaceContractFlowIndexes,
  type InterfaceContractComponent,
} from "./graph.js";
import type { InterfaceContractBoundaryCause } from "./boundary.js";
import {
  createExactInvocationInputIndex,
  type ExactInvocationInputIndex,
} from "../invocation/inputs.js";
import { createExactAggregateProjectionIndex } from "../aggregate/projection.js";
import {
  type InterfaceDispatchEvidence,
  type InterfaceDispatchBoundaryCauseEvidence,
  type InterfaceDispatchRejectionReason,
  type InterfaceDispatchRetentionEvidence,
  type InterfaceDispatchRetentionReason,
} from "./decision.js";

export interface DeclaredInterfaceDispatchFamily {
  readonly contractDeclarations: readonly Node[];
  readonly calls: readonly Node[];
  readonly implementations: readonly Node[];
  readonly candidates: readonly CooperativeEffectCandidate[];
  readonly coordinator?: CooperativeEffectCandidate;
  readonly returnRewrites: readonly CallableReturnRewrite[];
}

export interface DeclaredInterfaceDispatch {
  readonly profile: TypeScriptInterfaceDispatchProfile;
  readonly consideredContractCount: number;
  readonly consideredFamilyCount: number;
  readonly rejectedFamilyCount: number;
  readonly families: readonly DeclaredInterfaceDispatchFamily[];
  readonly calls: ReadonlyMap<Node, DeclaredInterfaceDispatchFamily>;
  readonly declarations: ReadonlyMap<Node, DeclaredInterfaceDispatchFamily>;
  readonly invocationInputs: ExactInvocationInputIndex;
  readonly invocationTransports?: InvocationTransportContract;
  addDependencies(
    owner: CooperativeEffectCandidate,
    family: DeclaredInterfaceDispatchFamily,
    kind: EffectProvenanceEdgeKind,
    occurrence: Node,
  ): void;
  block(
    family: DeclaredInterfaceDispatchFamily,
    reason: CooperativeEffectFallbackReason,
    occurrence: Node,
  ): void;
  callIsSettled(call: Node, optimized: ReadonlySet<Node>): boolean;
  settledReturnTypes(
    optimized: ReadonlySet<Node>,
  ): readonly CallableReturnRewrite[];
  evidence(
    optimized: ReadonlySet<Node>,
    retentions: CooperativeEffectRetentionDecisions,
  ): InterfaceDispatchEvidence;
}

interface RejectedInterfaceDispatchFamily {
  readonly component: InterfaceContractComponent;
  readonly reason: InterfaceDispatchRejectionReason;
}

type InterfaceDispatchFamilyResolution =
  | {
      readonly kind: "admitted";
      readonly family: DeclaredInterfaceDispatchFamily;
    }
  | {
      readonly kind: "rejected";
      readonly reason: Exclude<
        InterfaceDispatchRejectionReason,
        "open-ingress"
      >;
    };

export function createDeclaredInterfaceDispatch(
  source: TargetSourceProgram,
  program: TargetProgramIndex,
  candidates: ReadonlyMap<Node, CooperativeEffectCandidate>,
  profile: TypeScriptInterfaceDispatchProfile,
  transports?: InvocationTransportContract,
  sourceIdentityFor: SourceIdentityResolver = (sourceFile) =>
    source.documents.forFile(sourceFile).identity,
  indexes?: InterfaceContractFlowIndexes,
  cooperativeEffects: TypeScriptActiveCooperativeEffectProfile = "closed-direct",
  planningObserver?: TypeScriptPlanningObserver,
): DeclaredInterfaceDispatch {
  if (profile === "open-structural") {
    const aggregateProjections = indexes?.aggregateProjections ??
      createExactAggregateProjectionIndex(source, program);
    return createResult(
      source,
      sourceIdentityFor,
      profile,
      0,
      0,
      [],
      [],
      [],
      indexes?.invocationInputs ??
        createExactInvocationInputIndex(source, program, aggregateProjections),
    );
  }
  const graph = createInterfaceContractGraph(
    source,
    program,
    transports,
    sourceIdentityFor,
    indexes,
    cooperativeEffects,
    planningObserver,
  );
  const families: DeclaredInterfaceDispatchFamily[] = [];
  const rejected: RejectedInterfaceDispatchFamily[] = [];
  for (const component of graph.components) {
    if (component.boundary) {
      rejected.push({ component, reason: "open-ingress" });
      continue;
    }
    const resolution = resolveFamily(source, candidates, component);
    if (resolution.kind === "rejected") {
      rejected.push({ component, reason: resolution.reason });
      continue;
    }
    connectFamily(resolution.family.candidates);
    families.push(resolution.family);
  }
  return createResult(
    source,
    sourceIdentityFor,
    profile,
    graph.consideredCount,
    graph.components.length,
    families,
    rejected,
    graph.boundaryCauses,
    graph.invocationInputs,
    graph.invocationTransports,
  );
}

function resolveFamily(
  source: TargetSourceProgram,
  candidates: ReadonlyMap<Node, CooperativeEffectCandidate>,
  component: InterfaceContractComponent,
): InterfaceDispatchFamilyResolution {
  const implementations = new Set<Node>();
  const selectedCandidates = new Set<CooperativeEffectCandidate>();
  for (const entry of component.entries) {
    if (entry.implementations.length === 0 && entry.calls.length !== 0) {
      return { kind: "rejected", reason: "missing-implementer" };
    }
    for (const implementation of entry.implementations) {
      implementations.add(implementation);
      const candidate = candidates.get(implementation);
      if (candidate !== undefined) {
        selectedCandidates.add(candidate);
        continue;
      }
      if (!callableUsesSynchronousTransport(source, implementation)) {
        return {
          kind: "rejected",
          reason: "unproven-synchronous-implementation",
        };
      }
    }
  }
  const candidateList = Object.freeze([...selectedCandidates]);
  return Object.freeze({
    kind: "admitted",
    family: Object.freeze({
      contractDeclarations: Object.freeze(
        component.entries.map((entry) => entry.declaration),
      ),
      calls: Object.freeze(component.entries.flatMap((entry) => entry.calls)),
      implementations: Object.freeze([...implementations]),
      candidates: candidateList,
      ...(candidateList[0] === undefined
        ? {}
        : { coordinator: candidateList[0] }),
      returnRewrites: Object.freeze(
        component.entries.map((entry) => entry.returnRewrite),
      ),
    }),
  });
}

function connectFamily(
  candidates: readonly CooperativeEffectCandidate[],
): void {
  const coordinator = candidates[0];
  if (coordinator === undefined) {
    return;
  }
  for (const candidate of candidates.slice(1)) {
    connectCooperativeEffectDependency(
      coordinator,
      candidate,
      "implementation",
      candidate.declaration,
    );
    connectCooperativeEffectDependency(
      candidate,
      coordinator,
      "implementation",
      coordinator.declaration,
    );
  }
}

function createResult(
  source: TargetSourceProgram,
  sourceIdentityFor: SourceIdentityResolver,
  profile: TypeScriptInterfaceDispatchProfile,
  consideredContractCount: number,
  consideredFamilyCount: number,
  families: readonly DeclaredInterfaceDispatchFamily[],
  rejected: readonly RejectedInterfaceDispatchFamily[],
  boundaryCauses: readonly InterfaceDispatchBoundaryCauseEvidence[],
  invocationInputs: ExactInvocationInputIndex,
  invocationTransports?: InvocationTransportContract,
): DeclaredInterfaceDispatch {
  const calls = new Map<Node, DeclaredInterfaceDispatchFamily>();
  const declarations = new Map<Node, DeclaredInterfaceDispatchFamily>();
  for (const family of families) {
    for (const declaration of family.contractDeclarations) {
      const existing = declarations.get(declaration);
      if (existing !== undefined && existing !== family) {
        throw new Error(
          "interface declaration belongs to multiple declared families",
        );
      }
      declarations.set(declaration, family);
    }
    for (const call of family.calls) {
      if (calls.has(call)) {
        throw new Error("interface call belongs to multiple declared families");
      }
      calls.set(call, family);
    }
  }
  return Object.freeze({
    profile,
    consideredContractCount,
    consideredFamilyCount,
    rejectedFamilyCount: rejected.length,
    families: Object.freeze([...families]),
    calls,
    declarations,
    invocationInputs,
    ...(invocationTransports === undefined ? {} : { invocationTransports }),
    addDependencies(
      owner: CooperativeEffectCandidate,
      family: DeclaredInterfaceDispatchFamily,
      kind: EffectProvenanceEdgeKind,
      occurrence: Node,
    ): void {
      if (family.coordinator !== undefined) {
        connectCooperativeEffectDependency(
          owner,
          family.coordinator,
          kind,
          occurrence,
        );
      }
    },
    block(
      family: DeclaredInterfaceDispatchFamily,
      reason: CooperativeEffectFallbackReason,
      occurrence: Node,
    ): void {
      if (family.coordinator !== undefined) {
        blockCooperativeEffect(family.coordinator, reason, occurrence);
      }
    },
    callIsSettled(call: Node, optimized: ReadonlySet<Node>): boolean {
      const family = calls.get(call);
      return family !== undefined && family.candidates.every((candidate) =>
        optimized.has(candidate.declaration)
      );
    },
    settledReturnTypes(
      optimized: ReadonlySet<Node>,
    ): readonly CallableReturnRewrite[] {
      return Object.freeze(families.flatMap((family) =>
        family.candidates.every((candidate) =>
            optimized.has(candidate.declaration)
          )
          ? family.returnRewrites
          : []
      ));
    },
    evidence(
      optimized: ReadonlySet<Node>,
      retentions: CooperativeEffectRetentionDecisions,
    ): InterfaceDispatchEvidence {
      if (profile === "open-structural") {
        return Object.freeze({ profile, analyzed: false });
      }
      const settled = families.filter((family) =>
        family.candidates.every((candidate) =>
          optimized.has(candidate.declaration)
        )
      );
      const settledSet = new Set(settled);
      const retainedFamilies = [
        ...rejected.map((entry) => retentionEvidence(
          source,
          sourceIdentityFor,
          entry.reason,
          entry.component.entries.map((contract) => contract.declaration),
          entry.component.entries.reduce(
            (total, contract) => total + contract.calls.length,
            0,
          ),
          entry.component.boundaryCauses,
        )),
        ...families.filter((family) => !settledSet.has(family)).map((family) =>
          retentionEvidence(
            source,
            sourceIdentityFor,
            retainedFamilyReason(family, retentions),
            family.contractDeclarations,
            family.calls.length,
          )
        ),
      ].sort(compareRetentionEvidence);
      const admittedCallCount = calls.size;
      const rejectedCallCount = rejected.reduce(
        (total, entry) => total + entry.component.entries.reduce(
          (entryTotal, contract) => entryTotal + contract.calls.length,
          0,
        ),
        0,
      );
      const consideredCallCount = admittedCallCount + rejectedCallCount;
      const settledCallCount = settled.reduce(
        (total, family) => total + family.calls.length,
        0,
      );
      if (
        consideredFamilyCount !== families.length + rejected.length ||
        consideredFamilyCount !== settled.length + retainedFamilies.length ||
        consideredCallCount !== settledCallCount + retainedFamilies.reduce(
          (total, family) => total + family.callCount,
          0,
        )
      ) {
        throw new Error("interface dispatch evidence lost a decision row");
      }
      return Object.freeze({
        profile,
        analyzed: true,
        consideredContractCount,
        consideredFamilyCount,
        admittedFamilyCount: families.length,
        rejectedFamilyCount: rejected.length,
        consideredCallCount,
        admittedCallCount,
        rejectedCallCount,
        implementationCount: families.reduce(
          (total, family) => total + family.implementations.length,
          0,
        ),
        candidateImplementationCount: families.reduce(
          (total, family) => total + family.candidates.length,
          0,
        ),
        settledFamilyCount: settled.length,
        retainedFamilyCount: retainedFamilies.length,
        settledCallCount,
        retainedCallCount: consideredCallCount - settledCallCount,
        boundaryCauses: Object.freeze([...boundaryCauses]),
        retainedFamilies: Object.freeze(retainedFamilies),
      });
    },
  });
}

function retainedFamilyReason(
  family: DeclaredInterfaceDispatchFamily,
  retentions: CooperativeEffectRetentionDecisions,
): CooperativeEffectFallbackReason {
  for (const reason of cooperativeEffectFallbackReasons) {
    if (family.candidates.some((candidate) => retentions.get(candidate) === reason)) {
      return reason;
    }
  }
  throw new Error("retained interface family has no canonical blocker");
}

function retentionEvidence(
  source: TargetSourceProgram,
  sourceIdentityFor: SourceIdentityResolver,
  reason: InterfaceDispatchRetentionReason,
  declarations: readonly Node[],
  callCount: number,
  boundaryCauses: readonly InterfaceContractBoundaryCause[] = [],
): InterfaceDispatchRetentionEvidence {
  const contracts = declarations.map((declaration) =>
    optimizationOccurrence(source, declaration, sourceIdentityFor)
  ).sort(compareOptimizationOccurrences);
  if (contracts.length === 0) {
    throw new Error("interface family evidence has no contract declaration");
  }
  return Object.freeze({
    reason,
    contracts: Object.freeze(contracts),
    callCount,
    boundaryCauses: Object.freeze([...boundaryCauses]),
  });
}

function compareRetentionEvidence(
  left: InterfaceDispatchRetentionEvidence,
  right: InterfaceDispatchRetentionEvidence,
): number {
  const leftContract = left.contracts[0];
  const rightContract = right.contracts[0];
  if (leftContract === undefined || rightContract === undefined) {
    throw new Error("interface family evidence has no canonical contract");
  }
  return compareOptimizationOccurrences(leftContract, rightContract);
}
