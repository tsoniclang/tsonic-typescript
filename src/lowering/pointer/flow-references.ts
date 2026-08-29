import type { Node } from "@tsonic/tsts";
import type {
  SourceDeclarationReference,
  TargetSourceProgram,
} from "@tsonic/target-api/source";

import type { TargetProgramIndex } from "../program-index.js";
import type { PointerPlanningLedger } from "./planning-ledger.js";

export interface PointerReferenceCensus {
  readonly nodes: readonly Node[];
  referenceFor(node: Node | undefined): SourceDeclarationReference | undefined;
  tracks(declaration: Node | undefined): boolean;
  writesFor(declaration: Node | undefined): readonly Node[];
}

export interface PointerTrackedReferenceIndex {
  referenceFor(node: Node | undefined): SourceDeclarationReference | undefined;
}

export interface ExactDeclarationIndex {
  declarationFor(node: Node | undefined): Node | undefined;
}

export function indexExactDeclarations(
  source: TargetSourceProgram,
  declarations: ReadonlySet<Node>,
): ExactDeclarationIndex {
  return Object.freeze({
    declarationFor(node: Node | undefined) {
      const declaration = source.navigation.sourceReferenceFor(node)?.declaration;
      return declaration !== undefined && declarations.has(declaration)
        ? declaration
        : undefined;
    },
  });
}

export function indexPointerTrackedReferences(
  source: TargetSourceProgram,
  trackedDeclarations: ReadonlySet<Node>,
): PointerTrackedReferenceIndex {
  return Object.freeze({
    referenceFor(node: Node | undefined) {
      const reference = source.navigation.sourceReferenceFor(node);
      return reference !== undefined && trackedDeclarations.has(reference.declaration)
        ? reference
        : undefined;
    },
  });
}

export function censusPointerReferences(
  source: TargetSourceProgram,
  program: TargetProgramIndex,
  trackedDeclarations: ReadonlySet<Node>,
  planning?: PointerPlanningLedger,
): PointerReferenceCensus {
  const index = indexPointerTrackedReferences(
    source,
    trackedDeclarations,
  );
  const references = new Map<Node, SourceDeclarationReference>();
  const writesByDeclaration = new Map<Node, Set<Node>>();
  const candidates = pointerReferenceCandidates(source, trackedDeclarations);
  const selected = planning === undefined
    ? candidates
    : planning.candidates(
        "flow-census",
        "pointer-reference",
        candidates,
      );
  for (const node of selected) {
    const reference = index.referenceFor(node);
    if (reference === undefined) {
      continue;
    }
    references.set(node, reference);
    for (const write of program.bindingWritesAt(node)) {
      planning?.record("flow-census");
      const existing = writesByDeclaration.get(reference.declaration);
      if (existing === undefined) {
        writesByDeclaration.set(reference.declaration, new Set([write.operation]));
      } else {
        existing.add(write.operation);
      }
    }
  }
  planning?.assertCandidateCount("pointer-reference", candidates.length);
  return Object.freeze({
    nodes: Object.freeze([...references.keys()]),
    referenceFor(node: Node | undefined) {
      return node === undefined ? undefined : references.get(node);
    },
    tracks(declaration: Node | undefined) {
      return declaration !== undefined && trackedDeclarations.has(declaration);
    },
    writesFor(declaration: Node | undefined) {
      return declaration === undefined
        ? Object.freeze([])
        : Object.freeze([...(writesByDeclaration.get(declaration) ?? [])]);
    },
  });
}

function pointerReferenceCandidates(
  source: TargetSourceProgram,
  trackedDeclarations: ReadonlySet<Node>,
): readonly Node[] {
  const candidates = new Set<Node>();
  for (const declaration of trackedDeclarations) {
    const name = source.ast.name(declaration);
    if (
      name !== undefined &&
      source.navigation.sourceReferenceFor(name)?.declaration === declaration
    ) {
      candidates.add(name);
    }
    for (const reference of source.navigation.referencesToDeclaration(declaration)) {
      candidates.add(reference);
    }
  }
  return Object.freeze([...candidates]);
}
