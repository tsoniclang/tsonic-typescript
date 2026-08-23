import type { Node } from "@tsonic/tsts";

export const effectProvenanceVertexKinds = Object.freeze([
  "expression",
  "binding",
  "parameter",
  "result",
  "storage",
  "callable",
  "interface-value",
  "interface-container",
  "value-slot",
  "provider",
] as const);

export type EffectProvenanceVertexKind =
  typeof effectProvenanceVertexKinds[number];

export const effectProvenanceEdgeKinds = Object.freeze([
  "alias",
  "assignment",
  "argument",
  "return",
  "result-consumption",
  "field",
  "element",
  "projection",
  "conditional",
  "interface-conversion",
  "implementation",
  "callable-invocation",
  "provider-transport",
  "pointer-transport",
] as const);

export type EffectProvenanceEdgeKind =
  typeof effectProvenanceEdgeKinds[number];

export interface EffectProvenanceVertex {
  readonly index: number;
  readonly kind: EffectProvenanceVertexKind;
  readonly occurrence: Node;
}

export interface EffectProvenanceEdge {
  readonly source: EffectProvenanceVertex;
  readonly destination: EffectProvenanceVertex;
  readonly kind: EffectProvenanceEdgeKind;
  readonly occurrence: Node;
}

export interface EffectProvenanceBoundary<Reason extends string> {
  readonly vertex: EffectProvenanceVertex;
  readonly reason: Reason;
  readonly occurrence: Node;
}

export interface EffectProvenanceOrigin {
  readonly vertex: EffectProvenanceVertex;
  readonly occurrence: Node;
}

export interface EffectProvenanceGraph<Reason extends string> {
  readonly vertices: readonly EffectProvenanceVertex[];
  readonly edges: readonly EffectProvenanceEdge[];
  readonly origins: readonly EffectProvenanceOrigin[];
  readonly boundaries: readonly EffectProvenanceBoundary<Reason>[];
}

export interface EffectProvenanceResolution<Reason extends string> {
  readonly vertex: EffectProvenanceVertex;
  readonly component: number;
  readonly closed: boolean;
  readonly originless: boolean;
  readonly origins: readonly Node[];
  readonly originEvidence: readonly EffectProvenanceOrigin[];
  readonly boundaries: readonly EffectProvenanceBoundary<Reason>[];
  hasBoundaryReason(reason: Reason): boolean;
}

export interface EffectProvenanceResolutionIndex<Reason extends string> {
  readonly componentCount: number;
  readonly edgeCount: number;
  readonly work: number;
  componentFor(vertex: EffectProvenanceVertex): number;
  componentDependencyCount(component: number): number;
  componentDependency(
    component: number,
    index: number,
  ): number;
  componentDependentCount(component: number): number;
  componentDependent(
    component: number,
    index: number,
  ): number;
  resolutionFor(
    vertex: EffectProvenanceVertex,
  ): EffectProvenanceResolution<Reason>;
}
