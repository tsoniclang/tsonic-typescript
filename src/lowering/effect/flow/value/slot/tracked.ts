import type { Node } from "@tsonic/tsts";

import type { ExactValueSlotPath } from "./model.js";

export interface ExactTrackedValueSlotInput {
  readonly expression: Node;
  readonly path: ExactValueSlotPath;
}

export interface ExactTrackedValueSlot {
  readonly declaration: Node;
  readonly closed: boolean;
  readonly inputs: readonly ExactTrackedValueSlotInput[];
}
