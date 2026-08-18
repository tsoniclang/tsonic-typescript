import type { OptimizationOccurrence } from "../../../occurrence.js";
import type { CooperativeEffectFallbackReason } from "../../closure/retention.js";
import type { InterfaceContractBoundaryCause } from "./boundary.js";

export const interfaceDispatchRejectionReasons = Object.freeze([
  "open-ingress",
  "missing-implementer",
  "unproven-synchronous-implementation",
] as const);

export type InterfaceDispatchRejectionReason =
  typeof interfaceDispatchRejectionReasons[number];

export type InterfaceDispatchRetentionReason =
  | InterfaceDispatchRejectionReason
  | CooperativeEffectFallbackReason;

export interface InterfaceDispatchRetentionEvidence {
  readonly reason: InterfaceDispatchRetentionReason;
  readonly contracts: readonly OptimizationOccurrence[];
  readonly callCount: number;
  readonly boundaryCauses: readonly InterfaceDispatchBoundaryCauseEvidence[];
}

export interface InterfaceDispatchBoundaryCauseEvidence {
  readonly reason: InterfaceContractBoundaryCause["reason"];
  readonly occurrences: readonly OptimizationOccurrence[];
}

export type InterfaceDispatchEvidence =
  | {
      readonly profile: "open-structural";
      readonly analyzed: false;
    }
  | {
      readonly profile: "declared-closed";
      readonly analyzed: false;
    }
  | {
      readonly profile: "declared-closed";
      readonly analyzed: true;
      readonly consideredContractCount: number;
      readonly consideredFamilyCount: number;
      readonly admittedFamilyCount: number;
      readonly rejectedFamilyCount: number;
      readonly consideredCallCount: number;
      readonly admittedCallCount: number;
      readonly rejectedCallCount: number;
      readonly implementationCount: number;
      readonly candidateImplementationCount: number;
      readonly settledFamilyCount: number;
      readonly retainedFamilyCount: number;
      readonly settledCallCount: number;
      readonly retainedCallCount: number;
      readonly retainedFamilies: readonly InterfaceDispatchRetentionEvidence[];
    };
