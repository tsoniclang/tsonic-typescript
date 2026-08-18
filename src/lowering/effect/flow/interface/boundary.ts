import type { Node } from "@tsonic/tsts";

export const interfaceContractBoundaryReasons = Object.freeze([
  "missing-member-implementation",
  "unproven-value-origin",
  "open-interface-receiver",
  "unresolved-call-transport",
  "inexact-call-bindings",
  "opaque-call-transport",
  "unmatched-nested-contract",
  "incompatible-call-signature",
  "missing-transport-member",
  "untrusted-callable-member",
  "incompatible-type-arguments",
] as const);

export type InterfaceContractBoundaryReason =
  typeof interfaceContractBoundaryReasons[number];

export interface InterfaceContractBoundaryCause {
  readonly reason: InterfaceContractBoundaryReason;
  readonly occurrences: readonly Node[];
}

export interface InterfaceContractBoundaryLedger {
  mark(
    contract: Node,
    reason: InterfaceContractBoundaryReason,
    occurrence: Node,
  ): void;
  has(contract: Node): boolean;
  causesFor(contracts: readonly Node[]): readonly InterfaceContractBoundaryCause[];
}

export function createInterfaceContractBoundaryLedger(): InterfaceContractBoundaryLedger {
  const entries = new Map<
    Node,
    Map<InterfaceContractBoundaryReason, Set<Node>>
  >();
  return Object.freeze({
    mark(
      contract: Node,
      reason: InterfaceContractBoundaryReason,
      occurrence: Node,
    ): void {
      let reasons = entries.get(contract);
      if (reasons === undefined) {
        reasons = new Map();
        entries.set(contract, reasons);
      }
      const occurrences = reasons.get(reason);
      if (occurrences === undefined) {
        reasons.set(reason, new Set([occurrence]));
      } else {
        occurrences.add(occurrence);
      }
    },
    has(contract: Node): boolean {
      return entries.has(contract);
    },
    causesFor(
      contracts: readonly Node[],
    ): readonly InterfaceContractBoundaryCause[] {
      const selected = new Map<InterfaceContractBoundaryReason, Set<Node>>();
      for (const contract of contracts) {
        for (const [reason, occurrences] of entries.get(contract) ?? []) {
          let selectedOccurrences = selected.get(reason);
          if (selectedOccurrences === undefined) {
            selectedOccurrences = new Set();
            selected.set(reason, selectedOccurrences);
          }
          for (const occurrence of occurrences) {
            selectedOccurrences.add(occurrence);
          }
        }
      }
      return Object.freeze(
        interfaceContractBoundaryReasons.flatMap((reason) => {
          const occurrences = selected.get(reason);
          return occurrences === undefined
            ? []
            : [Object.freeze({
                reason,
                occurrences: Object.freeze([...occurrences]),
              })];
        }),
      );
    },
  });
}
