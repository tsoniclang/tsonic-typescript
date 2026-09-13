import { fieldFactKey, sourceMarkerFactKey, structFactKey } from "@tsonic/tsts";
import type { Node } from "@tsonic/tsts";
import type { TargetSourceProgram } from "@tsonic/target-api/source";
import type { GeneratedBindingName, SourceFileGeneratedNames } from "../../generated-names.js";
import { PointerLoweringError } from "../diagnostic.js";

export interface RecordSchema {
  readonly declaration: Node;
  readonly statement: Node;
  readonly name: { readonly kind: "authored" } | { readonly kind: "generated"; readonly binding: GeneratedBindingName };
  readonly fields: readonly string[];
}

export type RecordSchemaRewrite =
  | { readonly kind: "record-schema"; readonly schema: RecordSchema }
  | { readonly kind: "record-schema-reference"; readonly schema: RecordSchema }
  | { readonly kind: "record-schema-imported-query" };

export function planRecordSchemas(source: TargetSourceProgram, nodes: readonly Node[], names: SourceFileGeneratedNames) {
  const rewrites = new Map<Node, RecordSchemaRewrite>();
  const declarations = new Set<Node>();
  const ownedCalls = new Set<Node>();
  for (const node of nodes) {
    if (!source.ast.is.IsCallExpression(node)) continue;
    const marker = source.sourceFacts.getFact(source.ast.as.AsCallExpression(node)?.Expression, sourceMarkerFactKey);
    if (marker?.kind !== "call-marker" || marker.marker !== "struct") continue;
    const fact = source.sourceFacts.getFact(node, structFactKey);
    const declaration = source.ast.parent(node);
    const list = declaration === undefined ? undefined : source.ast.parent(declaration);
    const statement = list === undefined ? undefined : source.ast.parent(list);
    const shape = source.ast.arguments(node)[0];
    if (fact?.valueType !== true || fact.fields === undefined || declaration === undefined || list === undefined ||
        statement === undefined || !source.ast.is.IsVariableDeclaration(declaration) ||
        !source.ast.is.IsVariableStatement(statement) || source.ast.as.AsVariableDeclarationList(list)?.Declarations?.Nodes.length !== 1 ||
        source.ast.variableDeclarationKind(declaration) !== "const" ||
        shape === undefined || !source.ast.is.IsObjectLiteralExpression(shape)) {
      throw new PointerLoweringError("record schema requires one exact standalone shape declaration");
    }
    const name = source.ast.name(declaration);
    if (name === undefined || !source.ast.is.IsIdentifier(name)) throw new PointerLoweringError("record schema requires an identifier binding");
    const members = source.ast.properties(shape);
    if (members.length !== fact.fields.length) throw new PointerLoweringError("record schema field census is incomplete");
    for (const [index, member] of members.entries()) {
      if (member === undefined || !source.ast.is.IsPropertyAssignment(member)) throw new PointerLoweringError("record schema has a non-field member");
      const selected = source.sourceFacts.getFact(member, fieldFactKey);
      const call = source.ast.as.AsPropertyAssignment(member)?.Initializer;
      const fieldMarker = source.sourceFacts.getFact(call === undefined ? undefined : source.ast.as.AsCallExpression(call)?.Expression, sourceMarkerFactKey);
      const field = fact.fields[index];
      if (call === undefined || field === undefined || selected?.name !== field.name || selected.type !== field.type ||
          fieldMarker?.kind !== "call-marker" || fieldMarker.marker !== "field" || source.ast.typeArguments(call)[0] !== field.type) {
        throw new PointerLoweringError("record schema member lacks its exact selected field and type");
      }
      ownedCalls.add(call);
    }
    const uses = source.navigation.declarationUseSummary(declaration);
    if (uses.bindingWritten || uses.memberWritten) {
      throw new PointerLoweringError("record schema is not an immutable type-only declaration");
    }
    const aliases = new Set(uses.uses.flatMap(use => {
      const parent = source.ast.parent(use.reference);
      return parent !== undefined && source.ast.is.IsTypeAliasDeclaration(parent) && source.ast.name(parent) === use.reference ? [parent] : [];
    }));
    const hasTypeAlias = uses.uses.some(use => {
      const query = source.ast.parent(use.reference);
      const owner = query === undefined ? undefined : source.ast.parent(query);
      return query !== undefined && source.ast.is.IsTypeQueryNode(query) && owner !== undefined && aliases.has(owner) &&
        source.ast.as.AsTypeAliasDeclaration(owner)?.Type === query;
    });
    const schema = Object.freeze<RecordSchema>({ declaration, statement,
      name: hasTypeAlias ? { kind: "generated", binding: names.reserve(`${source.ast.text(name)}Fields`) } : { kind: "authored" },
      fields: Object.freeze(fact.fields.map(field => field.name)) });
    for (const use of uses.uses) {
      const parent = source.ast.parent(use.reference);
      if (parent !== undefined && source.ast.is.IsTypeAliasDeclaration(parent) && source.ast.name(parent) === use.reference) continue;
      if (use.kind === "source-linkage" && (hasTypeAlias || parent !== undefined && source.ast.isTypeOnlyImportOrExportDeclaration(parent))) continue;
      if (use.kind !== "type-only") {
        throw new PointerLoweringError("record schema has a value or nonlocal use without a type-only transport");
      }
      let query: Node | undefined = use.reference;
      while (query !== undefined && !source.ast.is.IsTypeQueryNode(query) && !source.ast.is.IsTypeReferenceNode(query) && query !== statement) query = source.ast.parent(query);
      if (query !== undefined && source.ast.is.IsTypeReferenceNode(query)) continue;
      if (query === undefined || !source.ast.is.IsTypeQueryNode(query)) {
        throw new PointerLoweringError("record schema reference has no exact authored type query");
      }
      const entity = source.ast.as.AsTypeQueryNode(query)?.ExprName;
      if (source.navigation.sourceReferenceFor(entityReference(source, entity))?.declaration !== declaration) {
        throw new PointerLoweringError("record schema type query must select the complete schema, not one of its value members");
      }
      if (source.ast.getSourceFile(query) !== names.sourceFile) continue;
      rewrites.set(query, { kind: "record-schema-reference", schema });
    }
    ownedCalls.add(node);
    rewrites.set(statement, { kind: "record-schema", schema });
  }
  for (const node of nodes) {
    if (!source.ast.is.IsTypeQueryNode(node)) continue;
    const name = source.ast.as.AsTypeQueryNode(node)?.ExprName;
    const reference = source.navigation.sourceReferenceFor(entityReference(source, name));
    const declaration = reference?.declaration;
    if (declaration === undefined || source.ast.getSourceFile(declaration) === names.sourceFile ||
        !source.ast.is.IsVariableDeclaration(declaration)) continue;
    const initializer = source.ast.as.AsVariableDeclaration(declaration)?.Initializer;
    const expression = initializer === undefined ? undefined : source.ast.as.AsCallExpression(initializer)?.Expression;
    const marker = source.sourceFacts.getFact(expression, sourceMarkerFactKey);
    if (marker?.kind !== "call-marker" || marker.marker !== "struct") continue;
    if (source.sourceFacts.getFact(initializer, structFactKey)?.valueType !== true) {
      throw new PointerLoweringError("imported record schema query lacks its finalized schema fact");
    }
    rewrites.set(node, { kind: "record-schema-imported-query" });
  }
  for (const node of nodes) {
    const marker = source.sourceFacts.getFact(node, sourceMarkerFactKey);
    if (marker?.kind !== "call-marker" || marker.marker !== "struct" && marker.marker !== "field") continue;
    if (source.ast.is.IsImportSpecifier(node)) {
      declarations.add(node);
      continue;
    }
    if (ownedCalls.has(node)) continue;
    const parent = source.ast.parent(node);
    if (parent !== undefined && (ownedCalls.has(parent) || source.ast.is.IsImportSpecifier(parent))) continue;
    throw new PointerLoweringError(`selected record marker at ${source.ast.kindName(node)}:${source.ast.pos(node)} has a use outside its exact type-only schema`);
  }
  return { rewrites, declarations };
}

function entityReference(source: TargetSourceProgram, name: Node | undefined): Node | undefined {
  return name !== undefined && source.ast.is.IsQualifiedName(name) ? source.ast.as.AsQualifiedName(name)?.Right : name;
}
