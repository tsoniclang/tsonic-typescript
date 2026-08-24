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
import type { CallableValueResolution } from "../callable/value-resolution.js";
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
  createInterfaceContractGraph,
  type InterfaceContractFlowIndexes,
  type InterfaceContractComponent,
} from "./graph.js";
import type { InterfaceContractBoundaryCause } from "./boundary.js";
import {
  createExactInvocationInputIndex,
  sameExactInvocationInputIndexes,
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
import {
  interfaceFamilyResolutionsRefine,
  resolveInterfaceDispatchFamily,
  resolveInterfaceValueImplementations,
  sameInterfaceFamilyResolutions,
} from "./dispatch/family-resolution.js";
import type { ExactCallableBodyInspection } from "../callable/result-inputs.js";

export interface DeclaredInterfaceDispatchFamily {
  readonly component: InterfaceContractComponent;
  readonly implementationSelections: readonly DeclaredInterfaceImplementationSelection[];
  readonly contractDeclarations: readonly Node[];
  readonly calls: readonly Node[];
  readonly implementations: readonly Node[];
  readonly valueImplementationBindings: readonly Node[];
  readonly candidates: readonly CooperativeEffectCandidate[];
  readonly coordinator?: CooperativeEffectCandidate;
  readonly returnRewrites: readonly CallableReturnRewrite[];
  readonly returnContractBlockers: readonly Node[];
}

export interface DeclaredInterfaceImplementationSelection {
  readonly declaration: Node;
  readonly implementations: readonly Node[];
  readonly valueImplementationBindings: readonly Node[];
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
  readonly invocationTransportCalls: readonly Node[];
  readonly invocationTransports?: InvocationTransportContract;
  implementationsForCall(call: Node): readonly Node[] | undefined;
  implementationsForDeclaration(
    declaration: Node,
  ): readonly Node[] | undefined;
  callIsRejected(call: Node): boolean;
  resolveValueImplementations(
    resolutionFor: (declaration: Node) => CallableValueResolution | undefined,
  ): DeclaredInterfaceDispatch;
  sameResolution(other: DeclaredInterfaceDispatch): boolean;
  refines(other: DeclaredInterfaceDispatch): boolean;
  connectCandidateDependencies(): void;
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
      candidates,
      sourceIdentityFor,
      profile,
      0,
      0,
      [],
      [],
      [],
      indexes?.invocationInputs ??
        createExactInvocationInputIndex(source, program, aggregateProjections),
      Object.freeze([]),
      undefined,
      indexes?.bodyInspectionIsCertified,
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
    const resolution = resolveInterfaceDispatchFamily(
      source,
      candidates,
      component,
      indexes?.bodyInspectionIsCertified,
    );
    if (resolution.kind === "rejected") {
      rejected.push({ component, reason: resolution.reason });
      continue;
    }
    families.push(resolution.family);
  }
  return createResult(
    source,
    candidates,
    sourceIdentityFor,
    profile,
    graph.consideredCount,
    graph.components.length,
    families,
    rejected,
    graph.boundaryCauses,
    graph.invocationInputs,
    graph.invocationTransportCalls,
    graph.invocationTransports,
    indexes?.bodyInspectionIsCertified,
  );
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
  candidates: ReadonlyMap<Node, CooperativeEffectCandidate>,
  sourceIdentityFor: SourceIdentityResolver,
  profile: TypeScriptInterfaceDispatchProfile,
  consideredContractCount: number,
  consideredFamilyCount: number,
  families: readonly DeclaredInterfaceDispatchFamily[],
  rejected: readonly RejectedInterfaceDispatchFamily[],
  boundaryCauses: readonly InterfaceDispatchBoundaryCauseEvidence[],
  invocationInputs: ExactInvocationInputIndex,
  invocationTransportCalls: readonly Node[],
  invocationTransports: InvocationTransportContract | undefined,
  bodyInspectionIsCertified: ExactCallableBodyInspection | undefined,
): DeclaredInterfaceDispatch {
  const calls = new Map<Node, DeclaredInterfaceDispatchFamily>();
  const declarations = new Map<Node, DeclaredInterfaceDispatchFamily>();
  const rejectedCalls = new Set<Node>();
  for (const entry of rejected) {
    for (const contract of entry.component.entries) {
      for (const call of contract.calls) {
        if (rejectedCalls.has(call)) {
          throw new Error("interface call belongs to multiple rejected families");
        }
        rejectedCalls.add(call);
      }
    }
  }
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
      if (calls.has(call) || rejectedCalls.has(call)) {
        throw new Error("interface call belongs to multiple declared families");
      }
      calls.set(call, family);
    }
  }
  let result: DeclaredInterfaceDispatch;
  result = Object.freeze({
    profile,
    consideredContractCount,
    consideredFamilyCount,
    rejectedFamilyCount: rejected.length,
    families: Object.freeze([...families]),
    calls,
    declarations,
    invocationInputs,
    invocationTransportCalls,
    ...(invocationTransports === undefined ? {} : { invocationTransports }),
    implementationsForCall(call: Node): readonly Node[] | undefined {
      const family = calls.get(call);
      if (family === undefined) {
        return undefined;
      }
      const declarations = family.component.entries.flatMap((entry) =>
        entry.calls.includes(call) ? [entry.declaration] : []
      );
      return declarations.length === 1
        ? implementationInputsFor(family, declarations[0]!)
        : undefined;
    },
    implementationsForDeclaration(
      declaration: Node,
    ): readonly Node[] | undefined {
      const family = declarations.get(declaration);
      return family === undefined
        ? undefined
        : implementationInputsFor(family, declaration);
    },
    callIsRejected(call: Node): boolean {
      return rejectedCalls.has(call);
    },
    resolveValueImplementations(
      resolutionFor: (declaration: Node) => CallableValueResolution | undefined,
    ): DeclaredInterfaceDispatch {
      if (families.every((family) =>
        family.valueImplementationBindings.length === 0
      )) {
        return result;
      }
      const resolvedFamilies: DeclaredInterfaceDispatchFamily[] = [];
      for (const family of families) {
        const resolution = resolveInterfaceValueImplementations(
          source,
          candidates,
          family,
          resolutionFor,
          bodyInspectionIsCertified,
        );
        if (resolution.kind !== "admitted") {
          throw new Error(
            "interface value implementation resolution rejected an admitted family",
          );
        }
        resolvedFamilies.push(resolution.family);
      }
      return createResult(
        source,
        candidates,
        sourceIdentityFor,
        profile,
        consideredContractCount,
        consideredFamilyCount,
        resolvedFamilies,
        rejected,
        boundaryCauses,
        invocationInputs,
        invocationTransportCalls,
        invocationTransports,
        bodyInspectionIsCertified,
      );
    },
    sameResolution(other: DeclaredInterfaceDispatch): boolean {
      return profile === other.profile &&
        consideredContractCount === other.consideredContractCount &&
        consideredFamilyCount === other.consideredFamilyCount &&
        rejected.length === other.rejectedFamilyCount &&
        sameInterfaceFamilyResolutions(families, other.families) &&
        sameNodes(
          invocationTransportCalls,
          other.invocationTransportCalls,
        ) &&
        sameExactInvocationInputIndexes(invocationInputs, other.invocationInputs);
    },
    refines(other: DeclaredInterfaceDispatch): boolean {
      return profile === other.profile &&
        consideredContractCount === other.consideredContractCount &&
        consideredFamilyCount === other.consideredFamilyCount &&
        rejected.length >= other.rejectedFamilyCount &&
        interfaceFamilyResolutionsRefine(families, other.families) &&
        nodesAreSubset(
          other.invocationTransportCalls,
          invocationTransportCalls,
        );
    },
    connectCandidateDependencies(): void {
      for (const family of families) {
        if (family.valueImplementationBindings.length === 0) {
          connectFamily(family.candidates);
          if (family.coordinator !== undefined) {
            for (const blocker of family.returnContractBlockers) {
              blockCooperativeEffect(
                family.coordinator,
                "incompatible-return",
                blocker,
              );
            }
          }
        }
      }
    },
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
      return family !== undefined &&
        family.valueImplementationBindings.length === 0 &&
        family.returnContractBlockers.length === 0 &&
        family.candidates.every((candidate) =>
          optimized.has(candidate.declaration)
        );
    },
    settledReturnTypes(
      optimized: ReadonlySet<Node>,
    ): readonly CallableReturnRewrite[] {
      return Object.freeze(families.flatMap((family) =>
        family.valueImplementationBindings.length === 0 &&
          family.returnContractBlockers.length === 0 &&
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
        family.valueImplementationBindings.length === 0 &&
        family.returnContractBlockers.length === 0 &&
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
  return result;
}

function implementationInputsFor(
  family: DeclaredInterfaceDispatchFamily,
  declaration: Node,
): readonly Node[] | undefined {
  const selection = family.implementationSelections.find((entry) =>
    entry.declaration === declaration
  );
  if (selection === undefined) {
    return undefined;
  }
  const implementations = new Set([
    ...selection.implementations,
    ...selection.valueImplementationBindings,
  ]);
  return Object.freeze([...implementations]);
}

function retainedFamilyReason(
  family: DeclaredInterfaceDispatchFamily,
  retentions: CooperativeEffectRetentionDecisions,
): InterfaceDispatchRetentionReason {
  if (family.valueImplementationBindings.length !== 0) {
    return "unproven-synchronous-implementation";
  }
  if (
    family.returnContractBlockers.length !== 0 &&
    family.coordinator === undefined
  ) {
    return "unproven-synchronous-implementation";
  }
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

function sameNodes(left: readonly Node[], right: readonly Node[]): boolean {
  return left.length === right.length && nodesAreSubset(left, right);
}

function nodesAreSubset(left: readonly Node[], right: readonly Node[]): boolean {
  const selected = new Set(right);
  return left.every((node) => selected.has(node));
}
