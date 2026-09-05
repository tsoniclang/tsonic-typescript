import type { Node, SourceFile } from "@tsonic/tsts";
import type { TargetSourceProgram } from "@tsonic/target-api/source";
import {
  readTsonicDataLayout, readTsonicMemoryLayout, readTsonicMemoryLayoutQuery,
  readTsonicMemoryFieldLayout, readTsonicRawMemoryOperation, readTsonicKeepAlive,
} from "@tsonic/source-core/facts";
import type { TsonicRawMemoryOperationFact, TsonicKeepAliveFact } from "@tsonic/source-core/facts";
import { PointerLoweringError } from "../diagnostic.js";
import { memoryProviderDeclaration } from "./identity.js";
import { scalarMemoryLayout } from "./layout.js";
import type { ScalarMemoryLayout } from "./layout.js";
import { validateRawMemoryCall, validateKeepAliveCall } from "./operation-contract.js";
import { planABIOperandUses } from "./abi-uses.js";

export type MemoryRewrite =
  | { readonly kind: "layout"; readonly layout: ScalarMemoryLayout }
  | { readonly kind: "raw"; readonly fact: TsonicRawMemoryOperationFact }
  | { readonly kind: "keep-alive"; readonly fact: TsonicKeepAliveFact }
  | { readonly kind: "query"; readonly value: number }
  | { readonly kind: "layout-type" }
  | { readonly kind: "abi-type" }
  | { readonly kind: "abi-token" };

export interface MemoryLoweringPlan {
  readonly rewrites: ReadonlyMap<Node, MemoryRewrite>;
  readonly removableDeclarations: ReadonlySet<Node>;
}

export function createMemoryLoweringPlan(
  source: TargetSourceProgram,
  sourceFile: SourceFile,
  nodes: readonly Node[],
): MemoryLoweringPlan {
  const rewrites = new Map<Node, MemoryRewrite>();
  const removableDeclarations = new Set<Node>();
  const consumedOperands = new Set<Node>();
  const importedMemory = nodes.some((node) => source.ast.is.IsImportSpecifier(node) && memoryProviderDeclaration(source, node) !== undefined);
  const namespaceImports = nodes.some((node) => source.ast.is.IsNamespaceImport(node));
  for (const node of nodes) {
    if (!source.ast.is.IsCallExpression(node)) continue;
    const raw = readTsonicRawMemoryOperation(source.sourceFacts, node);
    const layout = readTsonicMemoryLayout(source.sourceFacts, node);
    const query = readTsonicMemoryLayoutQuery(source.sourceFacts, node);
    const keepAlive = readTsonicKeepAlive(source.sourceFacts, node);
    const field = readTsonicMemoryFieldLayout(source.sourceFacts, node);
    const facts = [raw, layout, query, keepAlive, field].filter((fact) => fact?.call === node);
    if (facts.length === 0 && !importedMemory && !namespaceImports) continue;
    const selected = memoryProviderDeclaration(source, node);
    if (selected === undefined && facts.length === 0) continue;
    if (selected === undefined || facts.length !== 1) {
      throw new PointerLoweringError("selected memory operation requires one exact shared fact on its own call");
    }
    if (raw !== undefined) {
      validateRawMemoryCall(source, selected, raw);
      if (raw.operation === "raw-to-address-integer" || raw.operation === "address-integer-to-raw") {
        throw new PointerLoweringError("physical native address/integer conversion has no managed TypeScript representation");
      }
      if (raw.operation === "to-raw" || raw.operation === "reinterpret") {
        const selectedLayout = readTsonicMemoryLayout(source.sourceFacts, raw.layoutExpression);
        if (selectedLayout === undefined || !source.semantics.forNode(node).types.isIdentical(selectedLayout.sourceType, raw.pointeeType)) {
          throw new PointerLoweringError("raw conversion has no exact matching pointee layout");
        }
        scalarMemoryLayout(source, selectedLayout);
      } else {
        if (readTsonicDataLayout(source.sourceFacts, raw.dataLayoutExpression) === undefined) {
          throw new PointerLoweringError("raw byte offset is missing its selected source ABI fact");
        }
        consumedOperands.add(raw.dataLayoutExpression);
      }
      rewrites.set(node, { kind: "raw", fact: raw });
    } else if (layout?.call === node) {
      rewrites.set(node, { kind: "layout", layout: scalarMemoryLayout(source, layout) });
      consumedOperands.add(layout.dataLayoutExpression);
    } else if (query !== undefined) {
      const selectedLayout = readTsonicMemoryLayout(source.sourceFacts, query.layoutExpression);
      if (selectedLayout === undefined) throw new PointerLoweringError("layout query is missing its exact descriptor");
      let value: number;
      switch (query.operation) {
        case "size": value = selectedLayout.byteSize; break;
        case "alignment": value = selectedLayout.byteAlignment; break;
        case "stride": value = selectedLayout.stride; break;
        case "field-offset": {
          const fields = selectedLayout.fields.filter((candidate) => candidate.selectedDeclaration === query.selectedFieldDeclaration);
          if (fields.length !== 1 || fields[0] === undefined) throw new PointerLoweringError("layout query does not select exactly one field");
          value = fields[0].byteOffset;
          break;
        }
      }
      rewrites.set(node, { kind: "query", value });
    } else if (keepAlive !== undefined) {
      validateKeepAliveCall(source, selected, keepAlive);
      rewrites.set(node, { kind: "keep-alive", fact: keepAlive });
    } else {
      throw new PointerLoweringError("aggregate memory fields require an exact executable aggregate storage representation");
    }
    for (const argument of source.ast.arguments(node)) if (argument !== undefined) consumedOperands.add(argument);
  }
  if (rewrites.size === 0 && !importedMemory) return Object.freeze({ rewrites, removableDeclarations });
  const abiUses = planABIOperandUses(source, sourceFile, consumedOperands);
  for (const expression of abiUses.expressions) rewrites.set(expression, { kind: "abi-token" });
  for (const declaration of abiUses.imports) removableDeclarations.add(declaration);
  for (const node of nodes) {
    const dataLayout = readTsonicDataLayout(source.sourceFacts, node);
    if (dataLayout !== undefined) {
      if (!abiUses.expressions.has(node)) {
        throw new PointerLoweringError("ABI token has a use outside a certified memory operation");
      }
      rewrites.set(node, { kind: "abi-token" });
      const declaration = source.navigation.sourceReferenceFor(node)?.declaration;
      if (declaration !== undefined && source.ast.is.IsImportSpecifier(declaration)) removableDeclarations.add(declaration);
    }
    if (!source.ast.is.IsTypeReferenceNode(node) && !source.ast.is.IsImportSpecifier(node) &&
      !source.ast.is.IsIdentifier(node) && !source.ast.is.IsPropertyAccessExpression(node)) continue;
    const selected = memoryProviderDeclaration(source, node);
    if (selected === undefined) continue;
    if (source.ast.is.IsImportSpecifier(node)) {
      removableDeclarations.add(node);
    } else if (source.ast.is.IsTypeReferenceNode(node)) {
      const parent = source.ast.parent(node);
      if (selected.exportId === "DataLayout" && parent !== undefined && abiUses.aliases.has(parent)) {
        rewrites.set(node, { kind: "abi-type" });
        continue;
      }
      if (selected.exportId !== "MemoryLayout") throw new PointerLoweringError("memory descriptor type has no executable target representation at this use");
      rewrites.set(node, { kind: "layout-type" });
    } else {
      if (selected.exportId === "MemoryLayout" || selected.exportId === "MemoryFieldLayout") continue;
      const parent = source.ast.parent(node);
      if (selected.exportId === "DataLayout" && (abiUses.expressions.has(node) || parent !== undefined && abiUses.aliases.has(parent))) continue;
      if (parent !== undefined && (source.ast.is.IsImportSpecifier(parent) ||
        source.ast.is.IsTypeReferenceNode(parent) ||
        source.ast.is.IsCallExpression(parent) && source.ast.as.AsCallExpression(parent)?.Expression === node && rewrites.has(parent))) continue;
      throw new PointerLoweringError(`memory marker ${selected.exportId} at ${source.ast.kindName(node)}:${source.ast.pos(node)} is used without its exact finalized operation`);
    }
  }
  if (source.ast.getSourceFile(sourceFile) !== sourceFile) throw new PointerLoweringError("memory planning received an invalid source owner");
  return Object.freeze({ rewrites, removableDeclarations });
}
