import type { Node, SourceFile } from "@tsonic/tsts";
import type {
  SourceBindingWrite,
  SourceReferenceIndexStatistics,
} from "@tsonic/target-api/source";
import type { Kind } from "@tsonic/tsts/target-ast";

export interface TargetProgramIndexSelection {
  readonly bindingWrites: boolean;
  readonly excludeSubtreeRoot?: (node: Node) => boolean;
}

export interface TargetProgramIndexOperations {
  readonly nodeVisits: number;
  readonly childEdges: number;
  readonly kindEntries: number;
  readonly identifierEntries: number;
  readonly sourceReferenceIndex: SourceReferenceIndexStatistics;
  readonly bindingCandidates: number;
  readonly bindingWrites: number;
}

export interface TargetProgramIndex {
  readonly sourceFiles: readonly SourceFile[];
  readonly nodes: readonly Node[];
  readonly operations: TargetProgramIndexOperations;
  nodesFor(sourceFile: SourceFile): readonly Node[];
  hasAuthoredIdentifierName(sourceFile: SourceFile, name: string): boolean;
  authoredIdentifierNameCount(sourceFile: SourceFile): number;
  nodesOfKind(kind: Kind): readonly Node[];
  nodesOfKinds(kinds: readonly Kind[]): readonly Node[];
  hasBindingWrite(declaration: Node | undefined): boolean;
  bindingWritesAt(node: Node | undefined): readonly SourceBindingWrite[];
  bindingWritesFor(declaration: Node | undefined): readonly SourceBindingWrite[];
}
