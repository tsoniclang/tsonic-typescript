import type { Node } from "@tsonic/tsts";
import type { TargetSourceProgram } from "@tsonic/target-api/source";
import type { TargetProgramIndex } from "../../../../program-index.js";
import type { TypeScriptPlanningObserver } from "../../../../planning-observer.js";
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
  exactValueSlotPathIsReadonly,
  isExactObjectSpreadContainerReference,
} from "./selectors.js";
import { createExactStorageSlotInputIndex } from "./storage.js";
import {
  createClosedStorageOwnerAnalysis,
  type ClosedStorageOwnerAnalysis,
} from "../../storage/analysis.js";
import {
  createExactStructuralSlotWriteIndex,
} from "./structural-writes.js";
import {
  resolveExactValueSlotBatch,
  selectExactValueSlotRoots,
  type ExactValueSlotBatchMeasurements,
} from "./batch.js";
import { mergeExactValueSlotResolutions } from "./resolution.js";
import type { ExactCallImplementations } from "../../callable/result-inputs.js";
import type { StorageOwnerBoundaryDependencies } from "../../storage/owner-boundaries.js";

export const maximumExactValueSlotRootsPerBatch = 1;

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
  const domain = Object.freeze({
    source,
    program,
    projections,
    sourceForCall,
    bindings,
    bindingProjections,
    storageSlots,
    structuralWrites: createExactStructuralSlotWriteIndex(
      source,
      program,
      storageOwners.owners,
      exactCallImplementations,
      boundaryDependencies,
      planningObserver,
    ),
  });
  const selectedRoots = selectExactValueSlotRoots(domain, rootExpressions);
  const resolved = new Map<Node, ExactValueSlotResolution>();
  const measurements = emptyBatchMeasurements();
  let batches = 0;
  for (
    let offset = 0;
    offset < selectedRoots.length;
    offset += maximumExactValueSlotRootsPerBatch
  ) {
    const batch = resolveExactValueSlotBatch(
      domain,
      selectedRoots.slice(offset, offset + maximumExactValueSlotRootsPerBatch),
    );
    batches += 1;
    addBatchMeasurements(measurements, batch.measurements);
    mergeExactValueSlotResolutions(resolved, batch.resolutions);
    if (
      batches === 1 ||
      batches % 64 === 0 ||
      offset + maximumExactValueSlotRootsPerBatch >= selectedRoots.length
    ) {
      planningObserver?.("effect-value-slot-batch", {
        batches,
        roots: measurements.roots,
        vertices: measurements.vertices,
      });
    }
  }
  planningObserver?.("effect-value-slot-roots", {
    batches,
    roots: measurements.roots,
  });
  planningObserver?.("effect-value-slot-graph", {
    boundaries: measurements.boundaries,
    edges: measurements.edges,
    origins: measurements.origins,
    vertices: measurements.vertices,
  });
  planningObserver?.("effect-value-slot-components", {
    components: measurements.components,
  });
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
    roots: resolved.size,
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

interface MutableBatchMeasurements {
  boundaries: number;
  components: number;
  edges: number;
  origins: number;
  roots: number;
  vertices: number;
}

function emptyBatchMeasurements(): MutableBatchMeasurements {
  return {
    boundaries: 0,
    components: 0,
    edges: 0,
    origins: 0,
    roots: 0,
    vertices: 0,
  };
}

function addBatchMeasurements(
  total: MutableBatchMeasurements,
  batch: ExactValueSlotBatchMeasurements,
): void {
  total.boundaries += batch.boundaries;
  total.components += batch.components;
  total.edges += batch.edges;
  total.origins += batch.origins;
  total.roots += batch.roots;
  total.vertices += batch.vertices;
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
