import type { Node } from "@tsonic/tsts";
import type { TargetSourceProgram } from "@tsonic/target-api";

import {
  compareOptimizationOccurrences,
  optimizationOccurrence,
  type OptimizationOccurrence,
  type SourceIdentityResolver,
} from "../../../occurrence.js";

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
  readonly occurrenceCount: number;
  readonly examples: readonly OptimizationOccurrence[];
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

const maximumBoundaryExamples = 8;

export function createInterfaceContractBoundaryLedger(
  source: TargetSourceProgram,
  sourceIdentityFor: SourceIdentityResolver,
): InterfaceContractBoundaryLedger {
  const entries = new Map<
    Node,
    Map<InterfaceContractBoundaryReason, Set<number>>
  >();
  const occurrenceIdentifiers = new WeakMap<Node, number>();
  const occurrences = new Map<number, OptimizationOccurrence>();
  let nextOccurrenceIdentifier = 0;

  const identifierFor = (occurrence: Node): number => {
    const existing = occurrenceIdentifiers.get(occurrence);
    if (existing !== undefined) {
      return existing;
    }
    const identifier = nextOccurrenceIdentifier;
    nextOccurrenceIdentifier += 1;
    occurrenceIdentifiers.set(occurrence, identifier);
    occurrences.set(
      identifier,
      optimizationOccurrence(source, occurrence, sourceIdentityFor),
    );
    return identifier;
  };

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
        reasons.set(reason, new Set([identifierFor(occurrence)]));
      } else {
        occurrences.add(identifierFor(occurrence));
      }
    },
    has(contract: Node): boolean {
      return entries.has(contract);
    },
    causesFor(
      contracts: readonly Node[],
    ): readonly InterfaceContractBoundaryCause[] {
      const selected = new Map<InterfaceContractBoundaryReason, Set<number>>();
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
          const selectedOccurrences = selected.get(reason);
          if (selectedOccurrences === undefined) {
            return [];
          }
          const examples: OptimizationOccurrence[] = [];
          for (const identifier of selectedOccurrences) {
            insertCanonicalExample(
              examples,
              requiredOccurrence(occurrences, identifier),
            );
          }
          return [Object.freeze({
            reason,
            occurrenceCount: selectedOccurrences.size,
            examples: Object.freeze(examples),
          })];
        }),
      );
    },
  });
}

function insertCanonicalExample(
  examples: OptimizationOccurrence[],
  occurrence: OptimizationOccurrence,
): void {
  examples.push(occurrence);
  examples.sort(compareOptimizationOccurrences);
  if (examples.length > maximumBoundaryExamples) {
    examples.length = maximumBoundaryExamples;
  }
}

function requiredOccurrence(
  occurrences: ReadonlyMap<number, OptimizationOccurrence>,
  identifier: number,
): OptimizationOccurrence {
  const occurrence = occurrences.get(identifier);
  if (occurrence === undefined) {
    throw new Error("interface boundary lost an occurrence identity");
  }
  return occurrence;
}
