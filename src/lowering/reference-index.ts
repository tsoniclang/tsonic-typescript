import type { Node } from "@tsonic/tsts";
import {
  isProjectDeclarationOnlyName,
} from "./source-reference.js";
import {
  sourceNodeIdentity,
  sourceNodesEqual,
  type SourceDeclarationReference,
  type TargetSourceProgram,
} from "@tsonic/target-api";

const noReferences = Object.freeze([]) as readonly Node[];

export interface ProjectDeclarationReferenceIndex {
  readonly candidateCount: number;
  readonly referenceCount: number;
  declarationReferenceFor(node: Node | undefined):
    SourceDeclarationReference | undefined;
  referencesToDeclaration(declaration: Node | undefined): readonly Node[];
}

export function disabledProjectDeclarationReferenceIndex(): ProjectDeclarationReferenceIndex {
  return Object.freeze({
    candidateCount: 0,
    referenceCount: 0,
    declarationReferenceFor(): SourceDeclarationReference | undefined {
      throw new Error("project declaration-reference index was not selected");
    },
    referencesToDeclaration(): readonly Node[] {
      throw new Error("project declaration-reference index was not selected");
    },
  });
}

export function createProjectDeclarationReferenceIndex(
  source: TargetSourceProgram,
  candidates: readonly Node[],
): ProjectDeclarationReferenceIndex {
  const pending = new Map<string, Node[]>();
  const byReference = new Map<Node, SourceDeclarationReference>();
  let referenceCount = 0;
  for (const candidate of candidates) {
    const propertyName = isPropertyName(source, candidate);
    const declarationName = isProjectDeclarationOnlyName(source, candidate);
    const reference = source.navigation.sourceReferenceFor(candidate);
    if (reference !== undefined && !declarationName) {
      byReference.set(candidate, reference);
    }
    if (
      propertyName ||
      declarationName ||
      reference?.project !== true ||
      sourceNodesEqual(source.ast, source.ast.name(reference.declaration), candidate)
    ) {
      continue;
    }
    const declarationIdentity = sourceNodeIdentity(
      source.ast,
      reference.declaration,
    );
    if (declarationIdentity === undefined) {
      throw new Error("project reference has no canonical declaration identity");
    }
    const selected = pending.get(declarationIdentity);
    if (selected === undefined) {
      pending.set(declarationIdentity, [candidate]);
    } else {
      selected.push(candidate);
    }
    referenceCount += 1;
  }
  const byDeclaration = new Map<string, readonly Node[]>(
    [...pending].map(([identity, references]) => [
      identity,
      Object.freeze(references),
    ]),
  );
  return Object.freeze({
    candidateCount: candidates.length,
    referenceCount,
    declarationReferenceFor(
      node: Node | undefined,
    ): SourceDeclarationReference | undefined {
      return node === undefined ? undefined : byReference.get(node);
    },
    referencesToDeclaration(declaration: Node | undefined): readonly Node[] {
      const identity = sourceNodeIdentity(source.ast, declaration);
      return identity === undefined
        ? noReferences
        : byDeclaration.get(identity) ?? noReferences;
    },
  });
}

function isPropertyName(source: TargetSourceProgram, node: Node): boolean {
  const parent = source.ast.parent(node);
  return parent !== undefined &&
    source.ast.is.IsPropertyAccessExpression(parent) &&
    sourceNodesEqual(source.ast, source.ast.name(parent), node);
}
