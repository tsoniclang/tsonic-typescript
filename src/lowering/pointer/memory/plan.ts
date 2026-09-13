import type { Node, SourceFile } from "@tsonic/tsts";
import type { TargetSourceProgram } from "@tsonic/target-api/source";
import {
  readTsonicDataLayout, readTsonicMemoryLayout, readTsonicMemoryLayoutQuery,
  readTsonicMemoryFieldLayout, readTsonicRawMemoryOperation, readTsonicKeepAlive,
  readTsonicMemoryType,
  selectTsonicRawLocationOperation,
  resolveTsonicMemoryLayoutObservation,
  selectTsonicPointerView, selectTsonicMemoryFieldBinding, selectTsonicMemoryRecordBinding,
} from "@tsonic/source-core/facts";
import type { TsonicRawMemoryOperationFact, TsonicKeepAliveFact } from "@tsonic/source-core/facts";
import { PointerLoweringError } from "../diagnostic.js";
import { memoryProviderDeclaration } from "./identity.js";
import { createExecutableMemoryLayouts } from "./record-plan.js";
import type { ExecutableMemoryLayout, RecordMemoryField } from "./record-plan.js";
import type { SourceFileGeneratedNames } from "../../generated-names.js";
import { planRecordSchemas } from "./record-schema.js";
import type { RecordSchemaRewrite } from "./record-schema.js";
import type { ReferenceMemoryLayout } from "./references/plan.js";
import type { MemoryProgramPlan } from "./program-plan.js";
import { validateRawMemoryCall, validateKeepAliveCall } from "./operation-contract.js";
import { planABIOperandUses } from "./abi-uses.js";
import { metadataOnlyTypeImports } from "./metadata-imports.js";
import { planFixedArrayTypes } from "./fixed-array.js";
import { boundMemoryFieldKey, boundMemoryRecord } from "./bindings/plan.js";
import type { BoundMemoryRecord } from "./bindings/plan.js";

export type MemoryRewrite =
  | RecordSchemaRewrite
  | { readonly kind: "layout"; readonly layout: ExecutableMemoryLayout }
  | { readonly kind: "field"; readonly field: RecordMemoryField }
  | { readonly kind: "raw"; readonly fact: TsonicRawMemoryOperationFact }
  | { readonly kind: "keep-alive"; readonly fact: TsonicKeepAliveFact }
  | { readonly kind: "query"; readonly value: number }
  | { readonly kind: "metadata-value" }
  | { readonly kind: "metadata-type" }
  | { readonly kind: "layout-type" }
  | { readonly kind: "fixed-array-type"; readonly length: bigint; readonly lengthRuntimeBase: "number" | "bigint" }
  | { readonly kind: "abi-type" }
  | { readonly kind: "pointer-view" }
  | { readonly kind: "field-binding"; readonly key: string }
  | { readonly kind: "record-binding"; readonly record: BoundMemoryRecord }
  | { readonly kind: "field-binding-type" }
  | { readonly kind: "abi-token" };

export interface MemoryLoweringPlan {
  readonly references: readonly ReferenceMemoryLayout[];
  readonly rewrites: ReadonlyMap<Node, MemoryRewrite>;
  readonly removableDeclarations: ReadonlySet<Node>;
}

export function createMemoryLoweringPlan(
  source: TargetSourceProgram,
  sourceFile: SourceFile,
  nodes: readonly Node[],
  names: SourceFileGeneratedNames,
  program: MemoryProgramPlan,
): MemoryLoweringPlan {
  const { references, metadata } = program;
  if (!references.owns(source)) throw new PointerLoweringError("reference memory plan belongs to another checked program");
  references.validate(sourceFile);
  const referenceEntries = references.forFile(sourceFile);
  const executable = createExecutableMemoryLayouts(source, names, references);
  const schemas = planRecordSchemas(source, nodes, names);
  const rewrites = new Map<Node, MemoryRewrite>(schemas.rewrites);
  const removableDeclarations = new Set<Node>(schemas.declarations);
  const consumedOperands = new Set<Node>();
  const importedMemory = nodes.some((node) => source.ast.is.IsImportSpecifier(node) && memoryProviderDeclaration(source, node) !== undefined);
  const namespaceImports = nodes.some((node) => source.ast.is.IsNamespaceImport(node));
  for (const node of nodes) {
    if (!source.ast.is.IsCallExpression(node)) continue;
    const view = selectTsonicPointerView(source.ast, source.sourceFacts, node);
    const fieldBinding = selectTsonicMemoryFieldBinding(source.ast, source.sourceFacts, node);
    const recordBinding = selectTsonicMemoryRecordBinding(source.ast, source.sourceFacts, node);
    const bindings = [view, fieldBinding, recordBinding].filter(selection => selection !== undefined);
    if (bindings.length !== 0) {
      if (bindings.length !== 1 || bindings[0]?.kind !== "resolved") {
        throw new PointerLoweringError(bindings[0]?.kind === "rejected" ? bindings[0].reason : "location relationship requires one exact finalized selection");
      }
      if (view?.kind === "resolved") rewrites.set(node, { kind: "pointer-view" });
      if (fieldBinding?.kind === "resolved") rewrites.set(node, { kind: "field-binding", key: boundMemoryFieldKey(source, fieldBinding.operation.field) });
      if (recordBinding?.kind === "resolved") rewrites.set(node, { kind: "record-binding", record: boundMemoryRecord(source, names, recordBinding.operation) });
      for (const argument of source.ast.arguments(node)) if (argument !== undefined) consumedOperands.add(argument);
      continue;
    }
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
        const selection = selectTsonicRawLocationOperation(source.ast, source.sourceFacts, node);
        if (selection?.kind !== "resolved") {
          throw new PointerLoweringError(selection?.reason ?? "raw conversion has no finalized location selection");
        }
        executable.layout(selection.layout, selection.memoryType);
      } else {
        if (readTsonicDataLayout(source.sourceFacts, raw.dataLayoutExpression) === undefined) {
          throw new PointerLoweringError("raw byte offset is missing its selected source ABI fact");
        }
        consumedOperands.add(raw.dataLayoutExpression);
      }
      rewrites.set(node, { kind: "raw", fact: raw });
    } else if (layout?.call === node) {
      const memoryType = readTsonicMemoryType(source.sourceFacts, node);
      if (memoryType === undefined || memoryType.sourceType !== layout.sourceType) {
        throw new PointerLoweringError("memory descriptor requires its exact finalized memory-type contract");
      }
      if (program.requiresCodec(node)) rewrites.set(node, { kind: "layout", layout: executable.layout(layout) });
      else {
        validateMetadataPlacement(source, node, program);
        rewrites.set(node, { kind: "metadata-value" });
      }
      consumedOperands.add(layout.dataLayoutExpression);
    } else if (query !== undefined) {
      const observation = resolveTsonicMemoryLayoutObservation(source.sourceFacts, node);
      if (observation?.kind !== "resolved") {
        throw new PointerLoweringError(observation?.reason ?? "layout query is missing its exact finalized descriptor");
      }
      rewrites.set(node, { kind: "query", value: observation.value });
    } else if (keepAlive !== undefined) {
      validateKeepAliveCall(source, selected, keepAlive);
      rewrites.set(node, { kind: "keep-alive", fact: keepAlive });
    } else if (field !== undefined) {
      if (program.requiresCodec(node)) rewrites.set(node, { kind: "field", field: executable.field(field) });
      else {
        validateMetadataPlacement(source, node, program);
        rewrites.set(node, { kind: "metadata-value" });
      }
    } else {
      throw new PointerLoweringError("memory operation has no executable selected fact");
    }
    for (const argument of source.ast.arguments(node)) if (argument !== undefined) consumedOperands.add(argument);
  }
  for (const node of nodes) {
    const declaration = metadata.declaration(node);
    if (declaration === undefined || declaration.value.kind === "data-layout" || program.requiresCodec(declaration.value.fact.call)) continue;
    if (declaration.issues.length !== 0) throw new PointerLoweringError(declaration.issues.map(issue => issue.reason).join("; "));
    const annotation = source.ast.as.AsVariableDeclaration(node)?.Type;
    if (annotation !== undefined) rewrites.set(annotation, { kind: "metadata-type" });
  }
  planFixedArrayTypes(source, nodes, rewrites, removableDeclarations);
  if (rewrites.size === 0 && !importedMemory) return Object.freeze({ rewrites, removableDeclarations, references: referenceEntries });
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
      if (rewrites.get(node)?.kind === "metadata-type") continue;
      const parent = source.ast.parent(node);
      if (selected.exportId === "DataLayout" && parent !== undefined && abiUses.aliases.has(parent)) {
        rewrites.set(node, { kind: "abi-type" });
        continue;
      }
      if (selected.exportId === "MemoryFieldBinding") rewrites.set(node, { kind: "field-binding-type" });
      else if (selected.exportId === "MemoryLayout") rewrites.set(node, { kind: "layout-type" });
      else throw new PointerLoweringError("memory descriptor type has no executable target representation at this use");
    } else {
      if (selected.exportId === "MemoryLayout" || selected.exportId === "MemoryFieldLayout" || selected.exportId === "MemoryFieldBinding") continue;
      const parent = source.ast.parent(node);
      if (selected.exportId === "DataLayout" && (abiUses.expressions.has(node) || parent !== undefined && abiUses.aliases.has(parent))) continue;
      if (parent !== undefined && (source.ast.is.IsImportSpecifier(parent) ||
        source.ast.is.IsTypeReferenceNode(parent) ||
        source.ast.is.IsCallExpression(parent) && source.ast.as.AsCallExpression(parent)?.Expression === node && rewrites.has(parent))) continue;
      throw new PointerLoweringError(`memory marker ${selected.exportId} at ${source.ast.kindName(node)}:${source.ast.pos(node)} is used without its exact finalized operation`);
    }
  }
  if (source.ast.getSourceFile(sourceFile) !== sourceFile) throw new PointerLoweringError("memory planning received an invalid source owner");
  for (const declaration of metadataOnlyTypeImports(source, nodes, rewrites)) removableDeclarations.add(declaration);
  return Object.freeze({ rewrites, removableDeclarations, references: referenceEntries });
}

function validateMetadataPlacement(source: TargetSourceProgram, node: Node, program: MemoryProgramPlan): void {
  let operand = node;
  let parent = source.ast.parent(node);
  while (parent !== undefined && source.ast.is.IsParenthesizedExpression(parent)) {
    operand = parent;
    parent = source.ast.parent(parent);
  }
  if (parent !== undefined && (program.metadata.declaration(parent) !== undefined ||
    source.ast.is.IsExpressionStatement(parent) || program.metadata.isCompileTimeExpression(parent) ||
    readTsonicMemoryLayoutQuery(source.sourceFacts, parent) !== undefined)) return;
  if (parent !== undefined && source.ast.is.IsCallExpression(parent)) {
    const field = selectTsonicMemoryFieldBinding(source.ast, source.sourceFacts, parent);
    if (field?.kind === "resolved" && field.operation.fieldExpression === operand) return;
    const record = selectTsonicMemoryRecordBinding(source.ast, source.sourceFacts, parent);
    if (record?.kind === "resolved" && record.operation.layoutExpression === operand) return;
  }
  throw new PointerLoweringError("memory descriptor escapes its exact compile-time metadata uses");
}
