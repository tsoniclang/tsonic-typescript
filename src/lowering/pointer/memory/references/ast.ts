import type { Node, SourceFile } from "@tsonic/tsts";
import {
  AsSourceFile, KindEqualsToken, KindQuestionQuestionToken, KindUndefinedKeyword, KindUnknown,
  NewBinaryExpression, NewBlock, NewCallExpression, NewExportDeclaration, NewExportSpecifier,
  NewFunctionDeclaration, NewIdentifier, NewImportClause, NewImportDeclaration, NewImportSpecifier, NewIntersectionTypeNode,
  NewKeywordTypeNode, NewNamedExports, NewNamedImports, NewNumericLiteral, NewParenthesizedExpression,
  NewReturnStatement, NewStringLiteral, NewToken, NewTypeLiteralNode, NewUnionTypeNode, NewVariableDeclaration,
  NewVariableDeclarationList, NewVariableStatement, NodeFactory_NewNodeList, NodeFactory_UpdateSourceFile,
} from "@tsonic/tsts/target-ast";
import type { NodeFactory } from "@tsonic/tsts/target-ast";
import type { FinalNodeLookup } from "../../../final-nodes.js";
import type { GeneratedBindingName } from "../../../generated-names.js";
import { PointerLoweringError } from "../../diagnostic.js";
import { runtimeCall, runtimeType, requiredRuntimeNode as required } from "../../runtime-ast.js";
import type { ReferenceMemoryLayout } from "./plan.js";

export function referenceMemoryCall(factory: NodeFactory, layout: ReferenceMemoryLayout): Node {
  return required(NewCallExpression(factory, identifier(factory, layout.name), undefined, undefined,
    NodeFactory_NewNodeList(factory, []), 0), "reference memory owner call");
}

export function insertReferenceMemoryOwners(factory: NodeFactory, file: SourceFile, entries: readonly ReferenceMemoryLayout[],
  runtime: GeneratedBindingName, finalNodes: FinalNodeLookup): SourceFile {
  if (entries.length === 0) return file;
  const statements = entries.flatMap(entry => entry.moduleSpecifier === undefined
    ? definitionStatements(factory, entry, runtime, finalNodes)
    : [required(NewImportDeclaration(factory, undefined, NewImportClause(factory, KindUnknown, undefined,
      NewNamedImports(factory, NodeFactory_NewNodeList(factory, [required(NewImportSpecifier(factory, false,
        identifier(factory, entry.definition.name), identifier(factory, entry.name)), "reference codec import")]))),
      NewStringLiteral(factory, entry.moduleSpecifier, 0), undefined), "reference codec import declaration")]);
  const result = AsSourceFile(NodeFactory_UpdateSourceFile(factory, file,
    NodeFactory_NewNodeList(factory, [...statements, ...(file.Statements?.Nodes ?? [])]), file.EndOfFileToken));
  if (result === undefined) throw new PointerLoweringError("reference memory insertion lost its source file");
  return result;
}

function definitionStatements(factory: NodeFactory, entry: ReferenceMemoryLayout, runtime: GeneratedBindingName, finalNodes: FinalNodeLookup): Node[] {
  const definition = entry.definition;
  const syntax = definition.fact.explicitTypeNode;
  const whole = syntax === undefined ? undefined : finalNodes.forOriginal(syntax);
  const valueNode = finalNodes.forOriginal(definition.selection.valueTypeNode);
  if (whole === undefined || valueNode === undefined) throw new PointerLoweringError("reference codec owner lost its exact lowered type nodes");
  const value = definition.selection.excludeUndefined
    ? required(NewIntersectionTypeNode(factory, NodeFactory_NewNodeList(factory, [valueNode,
        required(NewTypeLiteralNode(factory, NodeFactory_NewNodeList(factory, [])), "non-nullish reference constraint")])), "non-nullish reference type")
    : valueNode;
  const type = runtimeType(factory, runtime, "MemoryLayout", [whole]);
  const cache = required(NewVariableStatement(factory, undefined, NewVariableDeclarationList(factory,
    NodeFactory_NewNodeList(factory, [required(NewVariableDeclaration(factory, identifier(factory, definition.cache), undefined,
      NewUnionTypeNode(factory, NodeFactory_NewNodeList(factory, [type,
        required(NewKeywordTypeNode(factory, KindUndefinedKeyword), "reference cache absence")])), undefined), "reference cache")]), 0)), "hoisted reference cache");
  const fact = definition.fact;
  const create = runtimeCall(factory, runtime, "referenceLayout", [value], [
    required(NewStringLiteral(factory, fact.dataLayout.byteOrder, 0), "reference byte order"),
    ...[fact.byteSize, fact.byteAlignment, fact.stride].map(dimension => required(NewNumericLiteral(factory, String(dimension), 0), "reference dimension")),
  ]);
  const initialize = required(NewParenthesizedExpression(factory, NewBinaryExpression(factory, undefined,
    identifier(factory, definition.cache), undefined, NewToken(factory, KindEqualsToken), create)), "reference initialization");
  const result = required(NewBinaryExpression(factory, undefined, identifier(factory, definition.cache), undefined,
    NewToken(factory, KindQuestionQuestionToken), initialize), "reference cache selection");
  const callable = required(NewFunctionDeclaration(factory, undefined, undefined, identifier(factory, definition.name), undefined,
    NodeFactory_NewNodeList(factory, []), type, undefined,
    NewBlock(factory, NodeFactory_NewNodeList(factory, [required(NewReturnStatement(factory, result), "reference return")]), true)), "reference codec owner");
  const exported = required(NewExportDeclaration(factory, undefined, false,
    NewNamedExports(factory, NodeFactory_NewNodeList(factory, [required(NewExportSpecifier(factory, false, undefined,
      identifier(factory, definition.name)), "reference owner export")])), undefined, undefined), "reference export declaration");
  return [cache, callable, exported];
}

function identifier(factory: NodeFactory, name: GeneratedBindingName): Node {
  return required(NewIdentifier(factory, name.text), "reference owner binding");
}
