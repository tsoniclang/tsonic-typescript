import type { Node } from "@tsonic/tsts";
import type { TargetSourceProgram } from "@tsonic/target-api";
import {
  KindClassDeclaration,
  KindClassExpression,
} from "@tsonic/tsts/target-ast";

import type { TargetProgramIndex } from "../program-index.js";
import type { StorageOwnerTransportContract } from "../storage-owner-transport.js";
import type { TypeScriptInterfaceDispatchProfile } from "../profile.js";
import {
  compareOptimizationOccurrences,
  optimizationOccurrence,
  type OptimizationOccurrence,
  type SourceIdentityResolver,
} from "../occurrence.js";
import type { CallableReturnRewrite } from "./callable-contract.js";
import type { CooperativeEffectCandidate } from "./candidate-inventory.js";
import {
  blockCooperativeEffect,
  cooperativeEffectFallbackReasons,
  type CooperativeEffectFallbackReason,
  type CooperativeEffectRetentionDecisions,
} from "./fallback.js";
import {
  callableBodyResultIsDefinitelyNonThenable,
} from "./synchronous.js";
import {
  createInterfaceContractGraph,
  type InterfaceContractComponent,
} from "./interface-contract-graph.js";
import type { InterfaceContractBoundaryCause } from "./interface-contract-boundary.js";
import { declaredInterfaceMemberImplementation } from "./interface-contract-member.js";

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
  addDependencies(
    owner: CooperativeEffectCandidate,
    family: DeclaredInterfaceDispatchFamily,
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

export const interfaceDispatchRejectionReasons = Object.freeze([
  "open-ingress",
  "incomplete-heritage",
  "missing-implementer",
  "unsupported-implementer",
  "missing-implementation",
  "unproven-synchronous-implementation",
] as const);

export type InterfaceDispatchRejectionReason =
  typeof interfaceDispatchRejectionReasons[number];

export type InterfaceDispatchRetentionReason =
  | InterfaceDispatchRejectionReason
  | CooperativeEffectFallbackReason;

export interface InterfaceDispatchRetentionEvidence {
  readonly reason: InterfaceDispatchRetentionReason;
  readonly contracts: readonly OptimizationOccurrence[];
  readonly callCount: number;
  readonly boundaryCauses: readonly InterfaceDispatchBoundaryCauseEvidence[];
}

export interface InterfaceDispatchBoundaryCauseEvidence {
  readonly reason: InterfaceContractBoundaryCause["reason"];
  readonly occurrences: readonly OptimizationOccurrence[];
}

export type InterfaceDispatchEvidence =
  | {
      readonly profile: "open-structural";
      readonly analyzed: false;
    }
  | {
      readonly profile: "declared-closed";
      readonly analyzed: false;
    }
  | {
      readonly profile: "declared-closed";
      readonly analyzed: true;
      readonly consideredContractCount: number;
      readonly consideredFamilyCount: number;
      readonly admittedFamilyCount: number;
      readonly rejectedFamilyCount: number;
      readonly consideredCallCount: number;
      readonly admittedCallCount: number;
      readonly rejectedCallCount: number;
      readonly implementationCount: number;
      readonly candidateImplementationCount: number;
      readonly settledFamilyCount: number;
      readonly retainedFamilyCount: number;
      readonly settledCallCount: number;
      readonly retainedCallCount: number;
      readonly retainedFamilies: readonly InterfaceDispatchRetentionEvidence[];
    };

interface HeritageIndex {
  readonly implementers: ReadonlyMap<Node, readonly Node[]>;
  readonly complete: boolean;
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
        "open-ingress" | "incomplete-heritage"
      >;
    };

export function createDeclaredInterfaceDispatch(
  source: TargetSourceProgram,
  program: TargetProgramIndex,
  candidates: ReadonlyMap<Node, CooperativeEffectCandidate>,
  profile: TypeScriptInterfaceDispatchProfile,
  transports?: StorageOwnerTransportContract,
  sourceIdentityFor: SourceIdentityResolver = (sourceFile) =>
    source.documents.forFile(sourceFile).identity,
): DeclaredInterfaceDispatch {
  if (profile === "open-structural") {
    return createResult(source, sourceIdentityFor, profile, 0, 0, [], []);
  }
  const graph = createInterfaceContractGraph(source, program, transports);
  const heritage = collectHeritageIndex(source, program);
  const families: DeclaredInterfaceDispatchFamily[] = [];
  const rejected: RejectedInterfaceDispatchFamily[] = [];
  for (const component of graph.components) {
    if (component.boundary) {
      rejected.push({ component, reason: "open-ingress" });
      continue;
    }
    if (!heritage.complete) {
      rejected.push({ component, reason: "incomplete-heritage" });
      continue;
    }
    const resolution = resolveFamily(source, candidates, heritage, component);
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
  );
}

function collectHeritageIndex(
  source: TargetSourceProgram,
  program: TargetProgramIndex,
): HeritageIndex {
  const implementers = new Map<Node, Node[]>();
  const closures = new Map<Node, ReadonlySet<Node> | null>();
  let complete = true;
  for (const declaration of program.nodesOfKinds([
    KindClassDeclaration,
    KindClassExpression,
  ])) {
    if (source.ast.hasModifierKind(declaration, "abstract")) {
      continue;
    }
    const closure = declaredHeritageClosure(
      source,
      declaration,
      closures,
      new Set(),
    );
    if (closure === undefined) {
      complete = false;
      continue;
    }
    for (const contract of closure) {
      const selected = implementers.get(contract);
      if (selected === undefined) {
        implementers.set(contract, [declaration]);
      } else {
        selected.push(declaration);
      }
    }
  }
  return Object.freeze({ implementers, complete });
}

function declaredHeritageClosure(
  source: TargetSourceProgram,
  declaration: Node,
  cache: Map<Node, ReadonlySet<Node> | null>,
  pending: Set<Node>,
): ReadonlySet<Node> | undefined {
  const cached = cache.get(declaration);
  if (cached !== undefined) {
    return cached ?? undefined;
  }
  if (pending.has(declaration)) {
    cache.set(declaration, null);
    return undefined;
  }
  pending.add(declaration);
  const heritage = source.navigation.declaredHeritage(declaration);
  if (heritage.kind === "unresolved") {
    pending.delete(declaration);
    cache.set(declaration, null);
    return undefined;
  }
  const closure = new Set<Node>();
  for (const edge of heritage.edges) {
    closure.add(edge.target.declaration);
    const inherited = declaredHeritageClosure(
      source,
      edge.target.declaration,
      cache,
      pending,
    );
    if (inherited === undefined) {
      pending.delete(declaration);
      cache.set(declaration, null);
      return undefined;
    }
    for (const inheritedDeclaration of inherited) {
      closure.add(inheritedDeclaration);
    }
  }
  pending.delete(declaration);
  const result = Object.freeze(closure);
  cache.set(declaration, result);
  return result;
}

function resolveFamily(
  source: TargetSourceProgram,
  candidates: ReadonlyMap<Node, CooperativeEffectCandidate>,
  heritage: HeritageIndex,
  component: InterfaceContractComponent,
): InterfaceDispatchFamilyResolution {
  const implementations = new Set<Node>();
  const selectedCandidates = new Set<CooperativeEffectCandidate>();
  for (const entry of component.entries) {
    const owner = source.ast.parent(entry.declaration);
    if (owner === undefined) {
      return { kind: "rejected", reason: "missing-implementation" };
    }
    const classes = heritage.implementers.get(owner) ?? [];
    if (classes.length === 0 && entry.calls.length !== 0) {
      return { kind: "rejected", reason: "missing-implementer" };
    }
    for (const declaration of classes) {
      if (!source.ast.is.IsClassDeclaration(declaration)) {
        return { kind: "rejected", reason: "unsupported-implementer" };
      }
      const implementation = declaredInterfaceMemberImplementation(
        source,
        declaration,
        entry.declaration,
      );
      if (implementation === undefined) {
        return { kind: "rejected", reason: "missing-implementation" };
      }
      implementations.add(implementation);
      const candidate = candidates.get(implementation);
      if (candidate !== undefined) {
        selectedCandidates.add(candidate);
        continue;
      }
      if (!callableBodyResultIsDefinitelyNonThenable(source, implementation)) {
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
    coordinator.dependencies.add(candidate);
    candidate.dependencies.add(coordinator);
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
): DeclaredInterfaceDispatch {
  const calls = new Map<Node, DeclaredInterfaceDispatchFamily>();
  for (const family of families) {
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
    addDependencies(
      owner: CooperativeEffectCandidate,
      family: DeclaredInterfaceDispatchFamily,
    ): void {
      if (family.coordinator !== undefined) {
        owner.dependencies.add(family.coordinator);
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
    boundaryCauses: Object.freeze(boundaryCauses.map((cause) =>
      Object.freeze({
        reason: cause.reason,
        occurrences: Object.freeze(cause.occurrences.map((occurrence) =>
          optimizationOccurrence(source, occurrence, sourceIdentityFor)
        ).sort(compareOptimizationOccurrences)),
      })
    )),
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
