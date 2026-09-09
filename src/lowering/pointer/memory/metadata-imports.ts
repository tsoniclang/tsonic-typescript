import type { Node, Symbol } from "@tsonic/tsts";
import type { TargetSourceProgram } from "@tsonic/target-api/source";
import type { MemoryRewrite } from "./plan.js";

export function metadataOnlyTypeImports(source: TargetSourceProgram, nodes: readonly Node[], rewrites: ReadonlyMap<Node, MemoryRewrite>): readonly Node[] {
  const candidates = new Map<Symbol, Node[]>();
  for (const node of nodes) {
    if (!source.ast.is.IsImportSpecifier(node)) continue;
    if (!source.ast.isTypeOnlyImportOrExportDeclaration(node)) continue;
    const name = source.ast.name(node);
    const selected = source.navigation.sourceReferenceFor(name);
    if (selected?.symbol === undefined) continue;
    const imports = candidates.get(selected.symbol) ?? [];
    imports.push(node);
    candidates.set(selected.symbol, imports);
  }
  const used = new Set<Symbol>();
  for (const node of nodes) {
    if (candidates.size === 0) break;
    if (!source.ast.is.IsIdentifier(node)) continue;
    const parent = source.ast.parent(node);
    if (parent !== undefined && source.ast.is.IsImportSpecifier(parent)) continue;
    const symbol = source.navigation.sourceReferenceFor(node)?.symbol;
    if (symbol === undefined || !candidates.has(symbol)) continue;
    if (erased(node)) used.add(symbol);
    else candidates.delete(symbol);
  }
  return Object.freeze([...candidates].flatMap(([symbol, imports]) => used.has(symbol) ? imports : []));

  function erased(node: Node): boolean {
    let current: Node | undefined = node;
    while (current !== undefined) {
      const rewrite = rewrites.get(current);
      if (rewrite?.kind === "metadata-type" || rewrite?.kind === "metadata-value" || rewrite?.kind === "query") return true;
      current = source.ast.parent(current);
    }
    return false;
  }
}
