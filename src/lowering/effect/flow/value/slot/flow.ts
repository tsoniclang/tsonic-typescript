import type { Node } from "@tsonic/tsts";
import type { TargetSourceProgram } from "@tsonic/target-api/source";
import type { TargetProgramIndex } from "../../../../program-index.js";
import type { TypeScriptPlanningObserver } from "../../../../planning-observer.js";
import { createEffectProvenanceGraphBuilder } from "../../../provenance/graph.js";
import type { EffectProvenanceVertex } from "../../../provenance/model.js";
import { resolveEffectProvenance } from "../../../provenance/resolution.js";
import { transparentExpression } from "../../../model/syntax.js";
import type { ExactAggregateProjectionIndex } from "../../aggregate/projection.js";
import type { ExactInvocationInputIndex } from "../../invocation/inputs.js";
import {
  createExactValueBindingInputs,
} from "../binding-inputs.js";
import {
  createExactValueBindingProjectionIndex,
} from "../binding-projection.js";
import type {
  ExactValueSlotCallSource,
  ExactValueSlotFlow,
  ExactValueSlotResolution,
} from "./model.js";
import {
  containingExactValueSlotRead,
  exactBindingSlotPath,
  exactValueSlotPathIsReadonly,
  exactValueSlotRead,
  isExactObjectSpreadContainerReference,
} from "./selectors.js";
import {
  createValueSlotActiveStates,
  createValueSlotStateRegistry,
} from "./worklist.js";
import { materializeExactValueSlotResolutions } from "./resolution.js";
import { createExactStorageSlotInputIndex } from "./storage.js";
import {
  createClosedStorageOwnerAnalysis,
  type ClosedStorageOwnerAnalysis,
} from "../../storage/analysis.js";
import {
  createExactStructuralSlotWriteIndex,
} from "./structural-writes.js";
import type {
  ValueSlotBoundaryReason,
  ValueSlotContext,
} from "./context.js";
import {
  drainValueSlotWorklist,
  stateForBindingProjection,
  stateForExpression,
} from "./engine.js";
import type { ExactCallImplementations } from "../../callable/result-inputs.js";
import type { StorageOwnerBoundaryDependencies } from "../../storage/owner-boundaries.js";

export function createExactValueSlotFlow(
  source: TargetSourceProgram,
  program: TargetProgramIndex,
  projections: ExactAggregateProjectionIndex,
  sourceForCall: (call: Node) => ExactValueSlotCallSource | undefined,
  invocationInputs: ExactInvocationInputIndex | undefined,
  rootExpressions: readonly Node[],
  planningObserver?: TypeScriptPlanningObserver,
  storageOwners: ClosedStorageOwnerAnalysis = createClosedStorageOwnerAnalysis(
    source,
    program,
  ),
  exactCallImplementations?: ExactCallImplementations,
  callableReferenceIsClosed?: (reference: Node) => boolean,
  boundaryDependencies?: StorageOwnerBoundaryDependencies,
): ExactValueSlotFlow {
  const storageSlots = createExactStorageSlotInputIndex(
    source,
    program,
    invocationInputs,
    storageOwners,
    planningObserver,
    exactCallImplementations,
    callableReferenceIsClosed,
    boundaryDependencies,
  );
  const bindings = createExactValueBindingInputs(
    source,
    program,
    invocationInputs,
    (reference, path) =>
      containingExactValueSlotRead(source, reference) !== undefined ||
      isExactObjectSpreadContainerReference(source, reference) ||
      exactInvocationInputIsClosed(reference, invocationInputs) ||
      storageSlots.isInput(reference) ||
      storageSlots.isOwnerReference(reference) ||
      exactValueSlotPathIsReadonly(source, reference, path),
  );
  planningObserver?.("effect-value-slot-bindings");
  const bindingProjections = createExactValueBindingProjectionIndex(
    source,
    program,
    invocationInputs,
  );
  planningObserver?.("effect-value-slot-binding-projections");
  const builder = createEffectProvenanceGraphBuilder<ValueSlotBoundaryReason>();
  const active = createValueSlotActiveStates();
  const context: ValueSlotContext = {
    source,
    projections,
    sourceForCall,
    bindings,
    bindingProjections,
    builder,
    states: createValueSlotStateRegistry(active, builder),
    resultSources: new Map(),
    valueOrigins: new Map(),
    steps: new Map(),
    worklist: [],
    active,
    storageSlots,
    structuralWrites: createExactStructuralSlotWriteIndex(
      source,
      program,
      storageOwners.owners,
      exactCallImplementations,
      boundaryDependencies,
      planningObserver,
    ),
  };
  const roots = new Map<Node, EffectProvenanceVertex>();
  for (const expression of rootExpressions) {
    const root = transparentExpression(source, expression) ?? expression;
    const projection = projections.projectionFor(root);
    if (projection !== undefined) {
      roots.set(
        root,
        stateForExpression(
          projection.source.initializer,
          Object.freeze([{
            kind: "element" as const,
            index: projection.index,
          }]),
          context,
        ).vertex,
      );
      drainValueSlotWorklist(context);
      continue;
    }
    const read = exactValueSlotRead(source, root);
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
      continue;
    }
    const binding = bindingProjections.projectionForReference(root);
    const path = binding === undefined
      ? undefined
      : exactBindingSlotPath(source, binding.steps);
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
      continue;
    }
    const alias = exactRootSlotAlias(source, program, root);
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
  planningObserver?.("effect-value-slot-roots", { roots: roots.size });
  const graph = context.builder.seal();
  planningObserver?.("effect-value-slot-graph", {
    boundaries: graph.boundaries.length,
    edges: graph.edges.length,
    origins: graph.origins.length,
    vertices: graph.vertices.length,
  });
  const resolutions = resolveEffectProvenance(graph);
  planningObserver?.("effect-value-slot-components", {
    components: resolutions.componentCount,
  });
  const resolved = materializeExactValueSlotResolutions(
    graph,
    resolutions,
    roots,
    context.valueOrigins,
    context.steps,
  );
  let closed = 0;
  let values = 0;
  let steps = 0;
  for (const resolution of resolved.values()) {
    if (resolution.closed) {
      closed += 1;
      values += resolution.expressions.length;
      steps += resolution.steps.length;
    }
  }
  planningObserver?.("effect-value-slot-resolution", {
    closed,
    roots: roots.size,
    steps,
    values,
  });
  return Object.freeze({
    resultFor(expression: Node): ExactValueSlotResolution | undefined {
      const root = transparentExpression(source, expression);
      return root === undefined ? undefined : resolved.get(root);
    },
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

function exactInvocationInputIsClosed(
  expression: Node,
  invocationInputs: ExactInvocationInputIndex | undefined,
): boolean {
  if (invocationInputs === undefined) {
    return false;
  }
  const parameters = invocationInputs.parametersFor(expression);
  return parameters !== undefined && parameters.length !== 0 &&
    parameters.every((parameter) => invocationInputs.isClosed(parameter));
}
