import type { Node, Type } from "@tsonic/tsts";
import type { SourceFileSemantics } from "@tsonic/target-api/source";

export interface ExactOpaqueValueSlotTransport {
  allows(
    semantics: SourceFileSemantics,
    argument: Node,
    sourceType: Type,
    targetType: Type,
  ): boolean;
}
