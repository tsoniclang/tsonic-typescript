import { providerVirtualDeclarationFactKey, sourceMarkerFactKey } from "@tsonic/tsts";
import type { Node } from "@tsonic/tsts";
import type { TargetSourceProgram } from "@tsonic/target-api/source";
import { isTsonicFixedArrayProviderType, selectTsonicFixedArrayFromSource, tsonicFixedArrayFactKey } from "@tsonic/source-core/facts";
import { PointerLoweringError } from "../diagnostic.js";
import type { MemoryRewrite } from "./plan.js";

export function planFixedArrayTypes(
  source: TargetSourceProgram,
  nodes: readonly Node[],
  rewrites: Map<Node, MemoryRewrite>,
  removable: Set<Node>,
): void {
  for (const node of nodes) {
    if (source.ast.is.IsCallExpression(node)) {
      const expression = source.ast.as.AsCallExpression(node)?.Expression;
      const marker = source.sourceFacts.getFact(expression, sourceMarkerFactKey);
      if (marker?.kind === "call-marker" && marker.marker === "default-value") {
        const semantics = source.semantics.forNode(node);
        const call = semantics.operations.call(node);
        if (call?.outcome !== "applicable") {
          throw new PointerLoweringError("default allocation requires its exact resolved result type");
        }
        const selection = selectTsonicFixedArrayFromSource(call.sourceResultType, semantics, source.sourceFacts);
        if (selection?.kind === "invalid") throw new PointerLoweringError(selection.reason);
        if (selection?.kind === "selected") {
          throw new PointerLoweringError("fixed-array default allocation has no executable JavaScript storage representation");
        }
      }
      continue;
    }
    if (source.ast.is.IsImportSpecifier(node)) {
      const declaration = source.navigation.sourceReferenceFor(source.ast.name(node))?.declaration;
      if (isTsonicFixedArrayProviderType(source.sourceFacts.getFact(declaration, providerVirtualDeclarationFactKey))) {
        if (!source.ast.isTypeOnlyImportOrExportDeclaration(node)) {
          throw new PointerLoweringError("fixed-array storage requires a type-only provider import");
        }
        removable.add(node);
      }
      continue;
    }
    if (!source.ast.is.IsTypeReferenceNode(node)) continue;
    const reference = source.ast.as.AsTypeReferenceNode(node);
    const fact = source.sourceFacts.getFact(node, tsonicFixedArrayFactKey);
    const marker = source.sourceFacts.getFact(reference?.TypeName, sourceMarkerFactKey);
    const selected = marker?.kind === "type-marker" && marker.marker === "fixed-array";
    if (!selected && fact === undefined) continue;
    const nameFact = source.sourceFacts.getFact(reference?.TypeName, tsonicFixedArrayFactKey);
    if (!selected || fact === undefined || nameFact === undefined || reference?.TypeArguments?.Nodes.length !== 2 ||
        fact.elementType !== reference.TypeArguments.Nodes[0] || nameFact.elementType !== fact.elementType ||
        nameFact.sourceType !== fact.sourceType || nameFact.elementSourceType !== fact.elementSourceType ||
        nameFact.length !== fact.length || nameFact.lengthRuntimeBase !== fact.lengthRuntimeBase) {
      throw new PointerLoweringError("fixed-array type requires its exact finalized element and extent evidence");
    }
    if (!source.ast.is.IsIdentifier(reference.TypeName)) {
      throw new PointerLoweringError("fixed-array storage requires an exact named provider type import");
    }
    if (insideMetadata(source, node, rewrites)) continue;
    rewrites.set(node, { kind: "fixed-array-type", length: fact.length, lengthRuntimeBase: fact.lengthRuntimeBase });
  }
  for (const node of nodes) {
    if (!source.ast.is.IsIdentifier(node)) continue;
    const declaration = source.navigation.sourceReferenceFor(node)?.declaration;
    const marker = source.sourceFacts.getFact(node, sourceMarkerFactKey);
    if (!(marker?.kind === "type-marker" && marker.marker === "fixed-array") &&
        !isTsonicFixedArrayProviderType(source.sourceFacts.getFact(declaration, providerVirtualDeclarationFactKey))) continue;
    const parent = source.ast.parent(node);
    if (parent !== undefined && (source.ast.is.IsImportSpecifier(parent) || rewrites.get(parent)?.kind === "fixed-array-type")) continue;
    if (insideMetadata(source, node, rewrites)) continue;
    throw new PointerLoweringError("fixed-array provider has a use without its exact target type disposition");
  }
}

function insideMetadata(source: TargetSourceProgram, node: Node, rewrites: ReadonlyMap<Node, MemoryRewrite>): boolean {
  let current: Node | undefined = node;
  while (current !== undefined) {
    const kind = rewrites.get(current)?.kind;
    if (kind === "metadata-type" || kind === "metadata-value") return true;
    current = source.ast.parent(current);
  }
  return false;
}
