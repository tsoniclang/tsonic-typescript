import type { Node, Type } from "@tsonic/tsts";
import type { SourceFileSemantics } from "@tsonic/target-api";

export interface OpaqueInterfaceExposureSink {
  markOpaqueInput(declaration: Node): void;
  markExposedContracts(
    semantics: SourceFileSemantics,
    root: Type,
  ): void;
  markExposedValueContracts(
    semantics: SourceFileSemantics,
    root: Type,
  ): void;
}
