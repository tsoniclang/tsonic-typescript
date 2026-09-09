import type { Node } from "@tsonic/tsts";
import {
  AsCallExpression, AsObjectLiteralExpression, AsPropertyAssignment, AsVariableDeclaration, AsVariableDeclarationList,
  AsVariableStatement, NewIdentifier, NewPropertySignatureDeclaration, NewStringLiteral,
  NewTypeAliasDeclaration, NewTypeLiteralNode, NewTypeReferenceNode, NodeFactory_NewNodeList,
} from "@tsonic/tsts/target-ast";
import type { NodeFactory } from "@tsonic/tsts/target-ast";
import { PointerLoweringError } from "../diagnostic.js";
import { requiredRuntimeNode as required } from "../runtime-ast.js";
import type { RecordSchemaRewrite } from "./record-schema.js";

export function rewriteRecordSchema(factory: NodeFactory, rewrite: RecordSchemaRewrite, updated: Node): Node {
  const name = required(NewIdentifier(factory, rewrite.schema.name.text), "record schema name");
  if (rewrite.kind === "record-schema-reference") {
    return required(NewTypeReferenceNode(factory, name, undefined), "record schema type reference");
  }
  const list = AsVariableStatement(updated)?.DeclarationList;
  const declaration = list === undefined ? undefined : AsVariableDeclarationList(list)?.Declarations?.Nodes[0];
  const initializer = declaration === undefined ? undefined : AsVariableDeclaration(declaration)?.Initializer;
  const shape = initializer === undefined ? undefined : AsCallExpression(initializer)?.Arguments?.Nodes[0];
  const properties = shape === undefined ? undefined : AsObjectLiteralExpression(shape)?.Properties?.Nodes;
  if (properties?.length !== rewrite.schema.fields.length) throw new PointerLoweringError("record schema lost its typed field set");
  const members = properties.map((property, index) => {
    const fieldCall = property === undefined ? undefined : AsPropertyAssignment(property)?.Initializer;
    const type = fieldCall === undefined ? undefined : AsCallExpression(fieldCall)?.TypeArguments?.Nodes[0];
    const fieldName = rewrite.schema.fields[index];
    if (type === undefined || fieldName === undefined) throw new PointerLoweringError("record schema lost a lowered field type");
    return required(NewPropertySignatureDeclaration(factory, undefined, NewStringLiteral(factory, fieldName, 0), undefined,
      type, undefined), "record schema field");
  });
  return required(NewTypeAliasDeclaration(factory, undefined, name, undefined,
    NewTypeLiteralNode(factory, NodeFactory_NewNodeList(factory, members))), "record schema type declaration");
}
