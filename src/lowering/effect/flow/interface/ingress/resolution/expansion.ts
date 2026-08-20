import type { Node } from "@tsonic/tsts";

import type { EffectProvenanceEdgeKind } from "../../../../provenance/model.js";
import type {
  InterfaceOriginBoundaryReason,
  OriginGraphContext,
  OriginRole,
  OriginState,
} from "../resolution.js";

export interface InterfaceOriginExpansion {
  dependency(
    destination: OriginState,
    source: Node,
    role: OriginRole,
    kind: EffectProvenanceEdgeKind,
    occurrence: Node,
    context: OriginGraphContext,
  ): void;
  declarationDependency(
    destination: OriginState,
    declaration: Node,
    role: OriginRole,
    kind: EffectProvenanceEdgeKind,
    occurrence: Node,
    context: OriginGraphContext,
  ): void;
  expandCompositeAlternatives(
    state: OriginState,
    expression: Node,
    inheritedRole: OriginRole,
    occurrence: Node,
    context: OriginGraphContext,
  ): boolean;
  expandSlotProjection(
    state: OriginState,
    expression: Node,
    role: OriginRole,
    context: OriginGraphContext,
  ): boolean;
  expandDeclaration(
    state: OriginState,
    declaration: Node,
    role: OriginRole,
    occurrence: Node,
    context: OriginGraphContext,
  ): void;
  storageDeclarationIsClosed(
    declaration: Node | undefined,
    context: OriginGraphContext,
  ): declaration is Node;
  terminal(
    state: OriginState,
    closed: boolean,
    occurrence: Node,
    context: OriginGraphContext,
    reason?: InterfaceOriginBoundaryReason,
  ): void;
  origin(
    state: OriginState,
    occurrence: Node,
    context: OriginGraphContext,
  ): void;
  boundary(
    state: OriginState,
    reason: InterfaceOriginBoundaryReason,
    occurrence: Node,
    context: OriginGraphContext,
  ): void;
}
