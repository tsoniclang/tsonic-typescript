import type { Node } from "@tsonic/tsts";
import type { TargetSourceProgram } from "@tsonic/target-api/source";
import { KindAwaitExpression } from "@tsonic/tsts/target-ast";

import type { TargetProgramIndex } from "../../program-index.js";
import {
  compareOptimizationOccurrences,
  optimizationOccurrence,
  type OptimizationOccurrence,
  type SourceIdentityResolver,
} from "../../occurrence.js";
import type {
  EffectBlockerPropagation,
  EffectPropagationRoot,
  EffectPropagationStep,
} from "../closure/blocker-propagation.js";
import {
  cooperativeEffectFallbackReasons,
  type CooperativeEffectFallbackReason,
  type CooperativeEffectRetentionDecisions,
} from "../closure/retention.js";
import type { CooperativeEffectCandidate } from "./candidates.js";
import { isFunctionLike } from "../model/syntax.js";
import type { EffectProvenanceEdgeKind } from "../provenance/model.js";

export type CooperativeAwaitRetentionEdge =
  | "direct"
  | EffectProvenanceEdgeKind;

export interface CooperativeAwaitReasonEvidence {
  readonly reason: CooperativeEffectFallbackReason;
  readonly awaitCount: number;
  readonly rootCount: number;
  readonly awaitExamples: readonly OptimizationOccurrence[];
  readonly rootExamples: readonly OptimizationOccurrence[];
}

export interface CooperativeAwaitAttribution {
  readonly totalAwaitCount: number;
  readonly settledAwaitCount: number;
  readonly retainedAwaitCount: number;
  readonly outsideCandidateAwaitCount: number;
  readonly retainedReasons: readonly CooperativeAwaitReasonEvidence[];
  readonly retentionEdges: readonly CooperativeAwaitEdgeEvidence[];
  readonly retainedOwners: readonly CooperativeAwaitOwnerEvidence[];
  readonly outsideCandidateExamples: readonly OptimizationOccurrence[];
}

export interface CooperativeAwaitRootEvidence {
  readonly declaration: OptimizationOccurrence;
  readonly occurrence: OptimizationOccurrence;
  readonly path: readonly OptimizationOccurrence[];
  readonly steps: readonly CooperativeAwaitPropagationStepEvidence[];
}

export interface CooperativeAwaitPropagationStepEvidence {
  readonly from: OptimizationOccurrence;
  readonly to: OptimizationOccurrence;
  readonly edge: EffectProvenanceEdgeKind;
  readonly occurrence: OptimizationOccurrence;
}

export interface CooperativeAwaitEdgeEvidence {
  readonly edge: CooperativeAwaitRetentionEdge;
  readonly awaitCount: number;
  readonly awaitExamples: readonly OptimizationOccurrence[];
}

export interface CooperativeAwaitOwnerEvidence {
  readonly owner: OptimizationOccurrence;
  readonly reason: CooperativeEffectFallbackReason;
  readonly retentionEdge: CooperativeAwaitRetentionEdge;
  readonly awaitCount: number;
  readonly awaitExamples: readonly OptimizationOccurrence[];
  readonly canonicalRoot: CooperativeAwaitRootEvidence;
  readonly roots: readonly CooperativeAwaitRootEvidence[];
}

interface MutableAwaitReason {
  awaitCount: number;
  readonly roots: Set<Node>;
  readonly awaits: Node[];
}

interface MutableAwaitOwner {
  readonly awaits: Node[];
  readonly roots: Map<Node, EffectPropagationRoot>;
  canonicalRoot: EffectPropagationRoot;
  retentionEdge: CooperativeAwaitRetentionEdge;
}

export function attributeCooperativeAwaits(
  source: TargetSourceProgram,
  program: TargetProgramIndex,
  candidates: ReadonlyMap<Node, CooperativeEffectCandidate>,
  retentions: CooperativeEffectRetentionDecisions,
  settledAwaits: ReadonlySet<Node>,
  propagation: EffectBlockerPropagation,
  sourceIdentityFor: SourceIdentityResolver,
): CooperativeAwaitAttribution {
  const reasons = new Map<CooperativeEffectFallbackReason, MutableAwaitReason>();
  const edges = new Map<CooperativeAwaitRetentionEdge, Node[]>();
  const owners = new Map<CooperativeEffectCandidate, MutableAwaitOwner>();
  const outside: Node[] = [];
  let settled = 0;
  let retained = 0;
  const awaits = program.nodesOfKind(KindAwaitExpression);
  for (const node of awaits) {
    if (settledAwaits.has(node)) {
      settled += 1;
      continue;
    }
    const owner = containingCandidate(source, candidates, node);
    if (owner === undefined) {
      outside.push(node);
      continue;
    }
    const reason = retentions.get(owner);
    if (reason === undefined) {
      throw new Error(
        "unsettled cooperative await belongs to a settled callable",
      );
    }
    const roots = propagation.rootsFor(owner).filter((root) =>
      root.reason === reason
    );
    if (roots.length === 0) {
      throw new Error("retained cooperative await has no canonical root");
    }
    const canonicalRoot = roots[0];
    if (canonicalRoot === undefined) {
      throw new Error("retained cooperative await lost its canonical root");
    }
    const retentionEdge = canonicalRoot.steps[0]?.kind ?? "direct";
    let entry = reasons.get(reason);
    if (entry === undefined) {
      entry = { awaitCount: 0, roots: new Set(), awaits: [] };
      reasons.set(reason, entry);
    }
    entry.awaitCount += 1;
    entry.awaits.push(node);
    for (const root of roots) {
      entry.roots.add(root.occurrence);
    }
    let ownerEntry = owners.get(owner);
    if (ownerEntry === undefined) {
      ownerEntry = {
        awaits: [],
        roots: new Map(),
        canonicalRoot,
        retentionEdge,
      };
      owners.set(owner, ownerEntry);
    } else if (
      ownerEntry.canonicalRoot !== canonicalRoot ||
      ownerEntry.retentionEdge !== retentionEdge
    ) {
      throw new Error("retained await owner changed its canonical root");
    }
    ownerEntry.awaits.push(node);
    for (const root of roots) {
      ownerEntry.roots.set(root.occurrence, root);
    }
    const edgeAwaits = edges.get(retentionEdge);
    if (edgeAwaits === undefined) {
      edges.set(retentionEdge, [node]);
    } else {
      edgeAwaits.push(node);
    }
    retained += 1;
  }
  if (settled + retained + outside.length !== awaits.length) {
    throw new Error("cooperative await attribution lost an occurrence");
  }
  const retainedOwners = Object.freeze([...owners].map(([owner, entry]) => {
    const reason = retentions.get(owner);
    if (reason === undefined || entry.awaits.length === 0) {
      throw new Error("retained await owner lost its decision or occurrences");
    }
    return Object.freeze({
      owner: optimizationOccurrence(
        source,
        owner.declaration,
        sourceIdentityFor,
      ),
      reason,
      retentionEdge: entry.retentionEdge,
      awaitCount: entry.awaits.length,
      awaitExamples: occurrenceExamples(source, entry.awaits, sourceIdentityFor),
      canonicalRoot: rootEvidence(
        source,
        entry.canonicalRoot,
        sourceIdentityFor,
      ),
      roots: Object.freeze([...entry.roots.values()].map((root) =>
        rootEvidence(source, root, sourceIdentityFor)
      ).sort((left, right) =>
        compareOptimizationOccurrences(left.occurrence, right.occurrence)
      )),
    });
  }).sort((left, right) =>
    compareOptimizationOccurrences(left.owner, right.owner)
  ));
  if (
    retainedOwners.reduce((total, owner) => total + owner.awaitCount, 0) !==
      retained
  ) {
    throw new Error("retained await owners do not conserve await inventory");
  }
  const retentionEdges = Object.freeze([...edges]
    .map(([edge, edgeAwaits]) => Object.freeze({
      edge,
      awaitCount: edgeAwaits.length,
      awaitExamples: occurrenceExamples(
        source,
        edgeAwaits,
        sourceIdentityFor,
      ),
    }))
    .sort((left, right) => left.edge.localeCompare(right.edge)));
  if (
    retentionEdges.reduce((total, entry) => total + entry.awaitCount, 0) !==
      retained
  ) {
    throw new Error("retained await edge classes do not partition inventory");
  }
  return Object.freeze({
    totalAwaitCount: awaits.length,
    settledAwaitCount: settled,
    retainedAwaitCount: retained,
    outsideCandidateAwaitCount: outside.length,
    retainedReasons: Object.freeze(
      cooperativeEffectFallbackReasons.flatMap((reason) => {
        const entry = reasons.get(reason);
        return entry === undefined
          ? []
          : [Object.freeze({
              reason,
              awaitCount: entry.awaitCount,
              rootCount: entry.roots.size,
              awaitExamples: occurrenceExamples(
                source,
                entry.awaits,
                sourceIdentityFor,
              ),
              rootExamples: occurrenceExamples(
                source,
                entry.roots,
                sourceIdentityFor,
              ),
            })];
      }),
    ),
    retentionEdges,
    retainedOwners,
    outsideCandidateExamples: occurrenceExamples(
      source,
      outside,
      sourceIdentityFor,
    ),
  });
}

function rootEvidence(
  source: TargetSourceProgram,
  root: EffectPropagationRoot,
  sourceIdentityFor: SourceIdentityResolver,
): CooperativeAwaitRootEvidence {
  return Object.freeze({
    declaration: optimizationOccurrence(
      source,
      root.declaration,
      sourceIdentityFor,
    ),
    occurrence: optimizationOccurrence(
      source,
      root.occurrence,
      sourceIdentityFor,
    ),
    path: Object.freeze(root.path.map((node) =>
      optimizationOccurrence(source, node, sourceIdentityFor)
    )),
    steps: Object.freeze(root.steps.map((step) =>
      propagationStepEvidence(source, step, sourceIdentityFor)
    )),
  });
}

function propagationStepEvidence(
  source: TargetSourceProgram,
  step: EffectPropagationStep,
  sourceIdentityFor: SourceIdentityResolver,
): CooperativeAwaitPropagationStepEvidence {
  return Object.freeze({
    from: optimizationOccurrence(source, step.from, sourceIdentityFor),
    to: optimizationOccurrence(source, step.to, sourceIdentityFor),
    edge: step.kind,
    occurrence: optimizationOccurrence(
      source,
      step.occurrence,
      sourceIdentityFor,
    ),
  });
}

function containingCandidate(
  source: TargetSourceProgram,
  candidates: ReadonlyMap<Node, CooperativeEffectCandidate>,
  node: Node,
): CooperativeEffectCandidate | undefined {
  let current = source.ast.parent(node);
  while (current !== undefined) {
    if (isFunctionLike(source, current)) {
      return candidates.get(current);
    }
    current = source.ast.parent(current);
  }
  return undefined;
}

function occurrenceExamples(
  source: TargetSourceProgram,
  nodes: Iterable<Node>,
  sourceIdentityFor: SourceIdentityResolver,
): readonly OptimizationOccurrence[] {
  return Object.freeze([...nodes]
    .map((node) => optimizationOccurrence(source, node, sourceIdentityFor))
    .sort(compareOptimizationOccurrences)
    .slice(0, 8));
}
