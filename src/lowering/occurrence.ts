import type { Node, SourceFile } from "@tsonic/tsts";
import type { TargetSourceProgram } from "@tsonic/target-api";

export type OptimizationOccurrence =
  | {
      readonly kind: "authored";
      readonly documentIdentity: string;
      readonly start: number;
      readonly end: number;
      readonly syntaxKind: string;
    }
  | {
      readonly kind: "synthetic";
      readonly syntaxKind: string;
    };

export type SourceIdentityResolver = (sourceFile: SourceFile) => string;

export function optimizationOccurrence(
  source: TargetSourceProgram,
  node: Node,
  sourceIdentityFor: SourceIdentityResolver,
): OptimizationOccurrence {
  const occurrence = source.documents.occurrenceFor(node);
  return occurrence.kind === "authored"
    ? Object.freeze({
        kind: "authored",
        documentIdentity: sourceIdentityFor(occurrence.document.sourceFile),
        start: occurrence.start,
        end: occurrence.end,
        syntaxKind: occurrence.syntaxKind,
      })
    : Object.freeze({
        kind: "synthetic",
        syntaxKind: occurrence.syntaxKind,
      });
}

export function compareOptimizationOccurrences(
  left: OptimizationOccurrence,
  right: OptimizationOccurrence,
): number {
  const leftKey = occurrenceKey(left);
  const rightKey = occurrenceKey(right);
  return leftKey < rightKey ? -1 : leftKey > rightKey ? 1 : 0;
}

function occurrenceKey(occurrence: OptimizationOccurrence): string {
  return occurrence.kind === "authored"
    ? `${occurrence.documentIdentity}\0${String(occurrence.start).padStart(12, "0")}\0${String(occurrence.end).padStart(12, "0")}\0${occurrence.syntaxKind}`
    : `\uffff\0${occurrence.syntaxKind}`;
}
