import type { Type } from "@tsonic/tsts";
import type { SourceFileSemantics } from "@tsonic/target-api";

export interface OpaqueInterfaceExposureSink {
  markAllProjectContracts(): void;
  markExposedContracts(
    semantics: SourceFileSemantics,
    root: Type,
  ): void;
  markExposedValueContracts(
    semantics: SourceFileSemantics,
    root: Type,
  ): void;
}
