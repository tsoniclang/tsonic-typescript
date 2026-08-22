import type { Node } from "@tsonic/tsts";

import type { EffectProvenanceVertex } from "../../../provenance/model.js";
import type { ExactValueSlotPath } from "./model.js";

export interface ValueSlotState {
  readonly vertex: EffectProvenanceVertex;
  expanded: boolean;
}

export type ValueSlotWorkItem =
  | {
    readonly kind: "expression";
    readonly state: ValueSlotState;
    readonly root: Node;
    readonly path: ExactValueSlotPath;
  }
  | {
    readonly kind: "binding-projection";
    readonly state: ValueSlotState;
    readonly reference: Node;
    readonly sources: readonly Node[];
    readonly path: ExactValueSlotPath;
  }
  | {
    readonly kind: "result";
    readonly state: ValueSlotState;
    readonly declaration: Node;
    readonly expressions: readonly (Node | undefined)[];
    readonly path: ExactValueSlotPath;
  };
