import {
  pointerFactKey,
  rawPointerFactKey,
  sourceMarkerFactKey,
} from "@tsonic/tsts";
import type {
  Node,
  SourceMarkerFact,
} from "@tsonic/tsts";
import type { TargetSourceProgram } from "@tsonic/target-api";

import { PointerLoweringError } from "./diagnostic.js";

export interface PointerMarkerUsagePlan {
  readonly removableDeclarations: ReadonlySet<Node>;
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
    let selectedMarkerCount = 0;
    for (const occurrence of descendants(source, root)) {
      const marker = source.sourceFacts.getFact(
        occurrence,
        sourceMarkerFactKey,
      );
      const selectedPointerType = source.sourceFacts.getFact(
        occurrence,
        pointerFactKey,
      ) !== undefined || source.sourceFacts.getFact(
        occurrence,
        rawPointerFactKey,
      ) !== undefined;
      if (
        (marker !== undefined && isPointerMarker(marker)) ||
        selectedPointerType
      ) {
        selectedOccurrences.add(occurrence);
        selectedMarkerCount += 1;
      }
      const reference = source.navigation.sourceReferenceFor(occurrence);
      if (
        reference !== undefined &&
        source.ast.is.IsNamespaceImport(reference.declaration)
      ) {
        selectedNamespaceBindings.add(reference.declaration);
        selectedNamespaceReceivers.add(occurrence);
      }
    }
    if (selectedMarkerCount === 0) {
      throw new PointerLoweringError(
        "selected pointer operation has no exact source-marker occurrence",
      );
    }
  }

  const removableDeclarations = new Set<Node>();
  for (const node of nodes) {
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
    const declarationName = source.ast.name(binding);
    const hasResidualReference = nodes.some((candidate) => {
      if (
        candidate === declarationName ||
        selectedNamespaceReceivers.has(candidate) ||
        !source.ast.is.IsIdentifier(candidate)
      ) {
        return false;
      }
      return source.navigation.sourceReferenceFor(candidate)?.declaration ===
        binding;
    });
    if (!hasResidualReference) {
      removableDeclarations.add(binding);
    }
  }

  return Object.freeze({ removableDeclarations });
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
    case "write-only-reference":
    case "read-write-reference":
    case "read-only-reference":
    case "shared-borrow":
    case "mutable-borrow":
    case "move":
    case "struct":
    case "field":
    case "attribute":
    case "default-value":
      return false;
  }
}
