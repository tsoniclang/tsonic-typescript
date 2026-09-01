import type { Node, SourceFile } from "@tsonic/tsts";
import type {
  SourceBindingWrite,
  SourceDeclarationReference,
  SourceProjectMemberDispatch,
} from "@tsonic/target-api";
import type { Kind } from "@tsonic/tsts/target-ast";

export interface TargetProgramIndexSelection {
  readonly bindingWrites: boolean;
  readonly memberDispatch: boolean;
  readonly declarationReferences?: boolean;
  readonly excludeSubtreeRoot?: (node: Node) => boolean;
}

export interface TargetProgramIndexOperations {
  readonly nodeVisits: number;
  readonly childEdges: number;
  readonly kindEntries: number;
  readonly identifierEntries: number;
  readonly referenceCandidates: number;
  readonly projectReferences: number;
  readonly bindingCandidates: number;
  readonly bindingWrites: number;
  readonly heritageEdges: number;
  readonly dispatchMembers: number;
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
  declarationReferenceFor(node: Node | undefined):
    SourceDeclarationReference | undefined;
  referencesToDeclaration(declaration: Node | undefined): readonly Node[];
  memberDispatch(node: Node | undefined): SourceProjectMemberDispatch | undefined;
}
