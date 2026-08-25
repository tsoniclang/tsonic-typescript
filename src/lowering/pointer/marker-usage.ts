import {
  pointerFactKey,
  rawPointerFactKey,
  sourceMarkerFactKey,
} from "@tsonic/tsts";
import type {
  Node,
  SourceMarkerFact,
} from "@tsonic/tsts";
import type { TargetSourceProgram } from "@tsonic/target-api/source";

import { PointerLoweringError } from "./diagnostic.js";

export interface PointerMarkerUsagePlan {
  readonly removableDeclarations: ReadonlySet<Node>;
}

export interface ExactPointerSelection {
  readonly node: Node;
  readonly marker?: SourceMarkerFact;
}

export function planPointerMarkerUsage(
  source: TargetSourceProgram,
  nodes: readonly Node[],
  selectedRoots: readonly Node[],
): PointerMarkerUsagePlan {
  const selectedOccurrences = new Set<Node>();
  const selectedNamespaceBindings = new Set<Node>();
  const selectedNamespaceReceivers = new Set<Node>();

  for (const root of selectedRoots) {
    const selections = exactPointerSelections(source, root);
    for (const selection of selections) {
      selectedOccurrences.add(selection.node);
      const reference = source.navigation.sourceReferenceFor(selection.node);
      if (
        reference !== undefined &&
        source.ast.is.IsNamespaceImport(reference.declaration)
      ) {
        selectedNamespaceBindings.add(reference.declaration);
        selectedNamespaceReceivers.add(selection.node);
      }
    }
    if (selections.length === 0) {
      throw new PointerLoweringError(
        "selected pointer operation has no exact source-marker occurrence",
      );
    }
  }

  const removableDeclarations = new Set<Node>();
  const residualNamespaceBindings = new Set<Node>();
  const namespaceDeclarationNames = new Set(
    [...selectedNamespaceBindings].flatMap((binding) => {
      const name = source.ast.name(binding);
      return name === undefined ? [] : [name];
    }),
  );
  for (const node of nodes) {
    if (
      selectedNamespaceBindings.size !== 0 &&
      !namespaceDeclarationNames.has(node) &&
      !selectedNamespaceReceivers.has(node) &&
      source.ast.is.IsIdentifier(node)
    ) {
      const declaration = source.navigation.sourceReferenceFor(node)?.declaration;
      if (declaration !== undefined && selectedNamespaceBindings.has(declaration)) {
        residualNamespaceBindings.add(declaration);
      }
    }
    const marker = source.sourceFacts.getFact(node, sourceMarkerFactKey);
    if (marker === undefined || !isPointerMarker(marker)) {
      continue;
    }
    if (selectedOccurrences.has(node)) {
      continue;
    }
    if (
      source.ast.is.IsImportSpecifier(node) ||
      source.ast.is.IsExportSpecifier(node)
    ) {
      removableDeclarations.add(node);
      continue;
    }
    const declarationOwner = markerDeclarationOwner(source, node);
    if (declarationOwner !== undefined) {
      removableDeclarations.add(declarationOwner);
      continue;
    }
    throw new PointerLoweringError(
      `selected pointer marker at ${source.ast.kindName(node)} is used as a runtime value without an exact lowering operation`,
    );
  }

  for (const binding of selectedNamespaceBindings) {
    if (!residualNamespaceBindings.has(binding)) {
      removableDeclarations.add(binding);
    }
  }

  return Object.freeze({ removableDeclarations });
}

export function exactPointerSelections(
  source: TargetSourceProgram,
  root: Node,
): readonly ExactPointerSelection[] {
  const selections: ExactPointerSelection[] = [];
  for (const node of descendants(source, root)) {
    const marker = source.sourceFacts.getFact(node, sourceMarkerFactKey);
    const selectedPointerType = source.sourceFacts.getFact(
      node,
      pointerFactKey,
    ) !== undefined || source.sourceFacts.getFact(
      node,
      rawPointerFactKey,
    ) !== undefined;
    if (marker !== undefined && isPointerMarker(marker)) {
      selections.push(Object.freeze({ node, marker }));
    } else if (selectedPointerType) {
      selections.push(Object.freeze({ node }));
    }
  }
  return Object.freeze(selections);
}

function markerDeclarationOwner(
  source: TargetSourceProgram,
  node: Node,
): Node | undefined {
  for (
    let current = source.ast.parent(node);
    current !== undefined;
    current = source.ast.parent(current)
  ) {
    if (
      source.ast.is.IsImportSpecifier(current) ||
      source.ast.is.IsExportSpecifier(current)
    ) {
      return current;
    }
    if (
      source.ast.is.IsImportDeclaration(current) ||
      source.ast.is.IsExportDeclaration(current) ||
      source.ast.is.IsSourceFile(current)
    ) {
      return undefined;
    }
  }
  return undefined;
}

function descendants(
  source: TargetSourceProgram,
  root: Node,
): readonly Node[] {
  const result: Node[] = [];
  const pending = [root];
  while (pending.length > 0) {
    const node = pending.pop();
    if (node === undefined) {
      continue;
    }
    result.push(node);
    for (const child of source.ast.children(node)) {
      if (child !== undefined) {
        pending.push(child);
      }
    }
  }
  return result;
}

function isPointerMarker(marker: SourceMarkerFact): boolean {
  if (marker.kind === "type-marker") {
    return marker.marker === "pointer" || marker.marker === "raw-pointer";
  }
  switch (marker.marker) {
    case "address-of":
    case "allocate":
    case "load":
    case "store":
    case "equal-pointer":
    case "hash-pointer":
    case "bind-pointer":
    case "project-pointer":
    case "bind-raw-pointer":
    case "equal-raw-pointer":
    case "hash-raw-pointer":
      return true;
    default:
      return false;
  }
}
