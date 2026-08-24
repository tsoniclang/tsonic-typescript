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
  ExactValueSlotPath,
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

const openValueSlotResolution: ExactValueSlotResolution = Object.freeze({
  closed: false,
  expressions: Object.freeze([]),
  steps: Object.freeze([]),
});

export type ExactValueSlotRoot =
  | {
      readonly kind: "expression";
      readonly expressions: readonly Node[];
      readonly source: Node;
      readonly path: ExactValueSlotPath;
    }
  | {
      readonly kind: "binding";
      readonly expressions: readonly Node[];
      readonly sources: readonly Node[];
      readonly path: ExactValueSlotPath;
    };

export function selectExactValueSlotRoots(
  domain: ExactValueSlotBatchDomain,
  expressions: readonly Node[],
): readonly ExactValueSlotRoot[] {
  const roots: ExactValueSlotRoot[] = [];
  const seen = new Set<Node>();
  for (const expression of expressions) {
    const root = transparentExpression(domain.source, expression) ?? expression;
    if (seen.has(root)) {
      continue;
    }
    seen.add(root);
    const selected = selectRoot(domain, root);
    if (selected !== undefined) {
      roots.push(selected);
    }
  }
  return Object.freeze(roots);
}

export function resolveExactValueSlotBatch(
  domain: ExactValueSlotBatchDomain,
  selectedRoots: readonly ExactValueSlotRoot[],
): ExactValueSlotBatchResult {
  if (selectedRoots.length > 1) {
    throw new Error("value-slot graph transaction received more than one root");
  }
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
    boundaryFound: false,
  };
  const roots = new Map<Node, EffectProvenanceVertex>();
  for (const selected of selectedRoots) {
    addRoot(selected, roots, context);
  }
  const graph = context.builder.seal();
  if (context.boundaryFound) {
    return Object.freeze({
      measurements: graphMeasurements(graph, 0, roots.size),
      resolutions: new Map(
        [...roots.keys()].map((root) => [root, openValueSlotResolution]),
      ),
    });
  }
  const componentResolutions = resolveEffectProvenance(graph);
  const resolutions = materializeExactValueSlotResolutions(
    graph,
    componentResolutions,
    roots,
    context.valueOrigins,
    context.steps,
  );
  return Object.freeze({
    measurements: graphMeasurements(
      graph,
      componentResolutions.componentCount,
      roots.size,
    ),
    resolutions,
  });
}

function graphMeasurements(
  graph: ReturnType<ValueSlotContext["builder"]["seal"]>,
  components: number,
  roots: number,
): ExactValueSlotBatchMeasurements {
  return Object.freeze({
    boundaries: graph.boundaries.length,
    components,
    edges: graph.edges.length,
    origins: graph.origins.length,
    roots,
    vertices: graph.vertices.length,
  });
}

function addRoot(
  selected: ExactValueSlotRoot,
  roots: Map<Node, EffectProvenanceVertex>,
  context: ValueSlotContext,
): void {
  const state = selected.kind === "expression"
    ? stateForExpression(selected.source, selected.path, context)
    : stateForBindingProjection(
        selected.expressions[0]!,
        selected.sources,
        selected.path,
        context,
      );
  for (const expression of selected.expressions) {
    roots.set(expression, state.vertex);
  }
  drainValueSlotWorklist(context);
}

function selectRoot(
  domain: ExactValueSlotBatchDomain,
  root: Node,
): ExactValueSlotRoot | undefined {
  const projection = domain.projections.projectionFor(root);
  if (projection !== undefined) {
    return expressionRoot(
      root,
      projection.source.initializer,
      Object.freeze([{ kind: "element", index: projection.index }]),
    );
  }
  const read = exactValueSlotRead(domain.source, root);
  if (read !== undefined) {
    return expressionRoot(
      root,
      read.receiver,
      Object.freeze([read.selector]),
    );
  }
  const binding = domain.bindingProjections.projectionForReference(root);
  const path = binding === undefined
    ? undefined
    : exactBindingSlotPath(domain.source, binding.steps);
  if (binding !== undefined && path !== undefined) {
    return Object.freeze({
      kind: "binding",
      expressions: Object.freeze([root]),
      sources: binding.sources,
      path,
    });
  }
  const alias = exactRootSlotAlias(domain.source, domain.program, root);
  return alias === undefined
    ? undefined
    : Object.freeze({
        kind: "expression",
        expressions: Object.freeze([root, alias.expression]),
        source: alias.read.receiver,
        path: Object.freeze([alias.read.selector]),
      });
}

function expressionRoot(
  expression: Node,
  source: Node,
  path: ExactValueSlotPath,
): ExactValueSlotRoot {
  return Object.freeze({
    kind: "expression",
    expressions: Object.freeze([expression]),
    source,
    path,
  });
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
