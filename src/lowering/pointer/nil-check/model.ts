import type { Node, SourceFile } from "@tsonic/tsts";

import type { GeneratedBindingName } from "../../generated-names.js";
import type {
  BoundedOptimizationReasonEvidence,
} from "../../retention-evidence.js";

export type DominatingNilCheckRetentionReason =
  | "external-binding"
  | "mutable-binding"
  | "no-direct-block-owner"
  | "no-unconditional-anchor"
  | "before-dominating-anchor"
  | "single-guard-suffix";

export interface DominatingNilCheckBindingPlan {
  readonly block: Node;
  readonly anchorStatement: Node;
  readonly anchorStatementIndex: number;
  readonly anchorGuard: Node;
  readonly checkedName: GeneratedBindingName;
  readonly guards: ReadonlySet<Node>;
}

export interface DominatingNilCheckSourcePlan {
  readonly bindingCount: number;
  readonly blockCount: number;
  readonly optimizedGuardCount: number;
  readonly eliminatedGuardCount: number;
  bindingForGuard(guard: Node): DominatingNilCheckBindingPlan | undefined;
  bindingsForBlock(block: Node): readonly DominatingNilCheckBindingPlan[];
}

export interface DominatingNilCheckPlan {
  readonly profile: "location" | "closed-direct";
  readonly analyzed: boolean;
  readonly candidateGuardCount: number;
  readonly optimizedBindingCount: number;
  readonly optimizedGuardCount: number;
  readonly eliminatedGuardCount: number;
  readonly retainedGuardCount: number;
  readonly fallbackReasons: readonly BoundedOptimizationReasonEvidence<
    DominatingNilCheckRetentionReason
  >[];
  forFile(sourceFile: SourceFile): DominatingNilCheckSourcePlan;
}
