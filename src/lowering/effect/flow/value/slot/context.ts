import type { Node } from "@tsonic/tsts";
import type { TargetSourceProgram } from "@tsonic/target-api/source";

import type { ExactAggregateProjectionIndex } from "../../aggregate/projection.js";
import type { ExactValueBindingInputs } from "../binding-inputs.js";
import type { ExactValueBindingProjectionIndex } from "../binding-projection.js";
import { createEffectProvenanceGraphBuilder } from "../../../provenance/graph.js";
import type { ExactStorageSlotInputIndex } from "./storage.js";
import type { ExactStructuralSlotWriteIndex } from "./structural-writes.js";
import type {
  ExactValueSlotCallSource,
  ExactValueSlotStep,
} from "./model.js";
import type {
  ValueSlotActiveStates,
  ValueSlotStateRegistry,
  ValueSlotWorkItem,
} from "./worklist.js";

export type ValueSlotBoundaryReason = "open-slot" | "recursive-slot";

export interface ValueSlotContext {
  readonly source: TargetSourceProgram;
  readonly projections: ExactAggregateProjectionIndex;
  readonly sourceForCall: (
    call: Node,
  ) => ExactValueSlotCallSource | undefined;
  readonly bindings: ExactValueBindingInputs;
  readonly bindingProjections: ExactValueBindingProjectionIndex;
  readonly builder: ReturnType<
    typeof createEffectProvenanceGraphBuilder<ValueSlotBoundaryReason>
  >;
  readonly states: ValueSlotStateRegistry;
  readonly resultSources: Map<Node, ExactValueSlotCallSource>;
  readonly valueOrigins: Map<number, Set<Node>>;
  readonly steps: Map<number, ExactValueSlotStep>;
  readonly worklist: ValueSlotWorkItem[];
  readonly active: ValueSlotActiveStates;
  readonly storageSlots: ExactStorageSlotInputIndex;
  readonly structuralWrites: ExactStructuralSlotWriteIndex;
}
