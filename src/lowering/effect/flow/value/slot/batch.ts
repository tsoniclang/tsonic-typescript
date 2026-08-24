import type { Node } from "@tsonic/tsts";
import type { TargetSourceProgram } from "@tsonic/target-api/source";

import type { TargetProgramIndex } from "../../../../program-index.js";
import { createEffectProvenanceGraphBuilder } from "../../../provenance/graph.js";
import type { EffectProvenanceVertex } from "../../../provenance/model.js";
import { resolveEffectProvenance } from "../../../provenance/resolution.js";
import { transparentExpression } from "../../../model/syntax.js";
import type { ExactAggregateProjectionIndex } from "../../aggregate/projection.js";
import type { ExactValueBindingInputs } from "../binding-inputs.js";
import type { ExactValueBindingProjectionIndex } from "../binding-projection.js";
import type { ExactStorageSlotInputIndex } from "./storage.js";
import type { ExactStructuralSlotWriteIndex } from "./structural-writes.js";
import type {
  ExactValueSlotCallSource,
  ExactValueSlotResolution,
} from "./model.js";
import {
  exactBindingSlotPath,
  exactValueSlotRead,
} from "./selectors.js";
import {
  createValueSlotActiveStates,
  createValueSlotStateRegistry,
} from "./worklist.js";
import { materializeExactValueSlotResolutions } from "./resolution.js";
import type {
  ValueSlotBoundaryReason,
  ValueSlotContext,
} from "./context.js";
import {
  drainValueSlotWorklist,
  stateForBindingProjection,
  stateForExpression,
} from "./engine.js";

export interface ExactValueSlotBatchDomain {
  readonly source: TargetSourceProgram;
  readonly program: TargetProgramIndex;
  readonly projections: ExactAggregateProjectionIndex;
  readonly sourceForCall: (
    call: Node,
  ) => ExactValueSlotCallSource | undefined;
  readonly bindings: ExactValueBindingInputs;
  readonly bindingProjections: ExactValueBindingProjectionIndex;
  readonly storageSlots: ExactStorageSlotInputIndex;
  readonly structuralWrites: ExactStructuralSlotWriteIndex;
}

export interface ExactValueSlotBatchMeasurements {
  readonly boundaries: number;
  readonly components: number;
  readonly edges: number;
  readonly origins: number;
  readonly roots: number;
  readonly vertices: number;
}

export interface ExactValueSlotBatchResult {
  readonly measurements: ExactValueSlotBatchMeasurements;
  readonly resolutions: ReadonlyMap<Node, ExactValueSlotResolution>;
}

export function resolveExactValueSlotBatch(
  domain: ExactValueSlotBatchDomain,
  rootExpressions: readonly Node[],
): ExactValueSlotBatchResult {
  const builder = createEffectProvenanceGraphBuilder<ValueSlotBoundaryReason>();
  const active = createValueSlotActiveStates();
  const context: ValueSlotContext = {
    source: domain.source,
    projections: domain.projections,
    sourceForCall: domain.sourceForCall,
    bindings: domain.bindings,
    bindingProjections: domain.bindingProjections,
    builder,
    states: createValueSlotStateRegistry(active, builder),
    resultSources: new Map(),
    valueOrigins: new Map(),
    steps: new Map(),
    worklist: [],
    active,
    storageSlots: domain.storageSlots,
    structuralWrites: domain.structuralWrites,
  };
  const roots = new Map<Node, EffectProvenanceVertex>();
  for (const expression of rootExpressions) {
    addRoot(expression, roots, context, domain);
  }
  const graph = context.builder.seal();
  const componentResolutions = resolveEffectProvenance(graph);
  const resolutions = materializeExactValueSlotResolutions(
    graph,
    componentResolutions,
    roots,
    context.valueOrigins,
    context.steps,
  );
  return Object.freeze({
    measurements: Object.freeze({
      boundaries: graph.boundaries.length,
      components: componentResolutions.componentCount,
      edges: graph.edges.length,
      origins: graph.origins.length,
      roots: roots.size,
      vertices: graph.vertices.length,
    }),
    resolutions,
  });
}

function addRoot(
  expression: Node,
  roots: Map<Node, EffectProvenanceVertex>,
  context: ValueSlotContext,
  domain: ExactValueSlotBatchDomain,
): void {
  const root = transparentExpression(domain.source, expression) ?? expression;
  const projection = domain.projections.projectionFor(root);
  if (projection !== undefined) {
    roots.set(
      root,
      stateForExpression(
        projection.source.initializer,
        Object.freeze([{ kind: "element", index: projection.index }]),
        context,
      ).vertex,
    );
    drainValueSlotWorklist(context);
    return;
  }
  const read = exactValueSlotRead(domain.source, root);
  if (read !== undefined) {
    roots.set(
      root,
      stateForExpression(
        read.receiver,
        Object.freeze([read.selector]),
        context,
      ).vertex,
    );
    drainValueSlotWorklist(context);
    return;
  }
  const binding = domain.bindingProjections.projectionForReference(root);
  const path = binding === undefined
    ? undefined
    : exactBindingSlotPath(domain.source, binding.steps);
  if (binding !== undefined && path !== undefined) {
    roots.set(
      root,
      stateForBindingProjection(
        root,
        binding.sources,
        path,
        context,
      ).vertex,
    );
    drainValueSlotWorklist(context);
    return;
  }
  const alias = exactRootSlotAlias(domain.source, domain.program, root);
  if (alias !== undefined) {
    const state = stateForExpression(
      alias.read.receiver,
      Object.freeze([alias.read.selector]),
      context,
    );
    roots.set(root, state.vertex);
    roots.set(alias.expression, state.vertex);
    drainValueSlotWorklist(context);
  }
}

function exactRootSlotAlias(
  source: TargetSourceProgram,
  program: TargetProgramIndex,
  root: Node,
): {
  readonly expression: Node;
  readonly read: NonNullable<ReturnType<typeof exactValueSlotRead>>;
} | undefined {
  let current = root;
  const seen = new Set<Node>();
  while (source.ast.is.IsIdentifier(current) && !seen.has(current)) {
    seen.add(current);
    const reference = source.navigation.sourceReferenceFor(current);
    const declaration = reference?.project === true
      ? reference.declaration
      : undefined;
    if (
      declaration === undefined ||
      !source.ast.is.IsVariableDeclaration(declaration) ||
      program.hasBindingWrite(declaration)
    ) {
      return undefined;
    }
    const initializer = transparentExpression(
      source,
      source.ast.as.AsVariableDeclaration(declaration)?.Initializer,
    );
    if (initializer === undefined) {
      return undefined;
    }
    const read = exactValueSlotRead(source, initializer);
    if (read !== undefined) {
      return Object.freeze({ expression: initializer, read });
    }
    current = initializer;
  }
  return undefined;
}
