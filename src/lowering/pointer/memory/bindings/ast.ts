import type { Node } from "@tsonic/tsts";
import {
  AsCallExpression, KindEqualsGreaterThanToken, KindEqualsEqualsEqualsToken,
  KindNumberKeyword, KindStringKeyword, KindSymbolKeyword, NodeFlagsConst,
  KindQuestionToken, KindColonToken,
  NewArrayLiteralExpression, NewArrowFunction, NewBinaryExpression, NewBlock, NewComputedPropertyName,
  NewConditionalExpression, NewElementAccessExpression, NewExpressionStatement,
  NewGetAccessorDeclaration, NewIdentifier, NewIndexedAccessTypeNode,
  NewKeywordTypeNode, NewLiteralTypeNode, NewNumericLiteral, NewObjectLiteralExpression,
  NewParameterDeclaration, NewPropertyAssignment,
  NewReturnStatement, NewSetAccessorDeclaration, NewStringLiteral, NewToken,
  NewTypeQueryNode, NewUnionTypeNode, NewVariableDeclaration, NewVariableDeclarationList,
  NewVariableStatement, NewVoidExpression, NodeFactory_NewNodeList, KindEqualsToken,
} from "@tsonic/tsts/target-ast";
import type { NodeFactory } from "@tsonic/tsts/target-ast";
import type { GeneratedBindingName } from "../../../generated-names.js";
import { PointerLoweringError } from "../../diagnostic.js";
import { requiredRuntimeNode as required, runtimeCall } from "../../runtime-ast.js";
import type { BoundMemoryField, BoundMemoryRecord } from "./plan.js";

export function rewriteBoundField(factory: NodeFactory, key: string, updated: Node): Node {
  const args = AsCallExpression(updated)?.Arguments?.Nodes;
  if (args?.length !== 2 || args[1] === undefined) throw new PointerLoweringError("field binding lost its pointer operand");
  return object(factory, [property(factory, key, args[1])]);
}

export function rewriteBoundRecord(factory: NodeFactory, record: BoundMemoryRecord,
  updated: Node, runtime: GeneratedBindingName): Node {
  const args = AsCallExpression(updated)?.Arguments?.Nodes;
  if (args?.length !== record.fields.length + 1) throw new PointerLoweringError("record binding lost its exact ordered operands");
  const captured = record.fields.map((field, index) => property(factory, field.slot.text,
    required(args[index + 1], "field binding operand")));
  const declarations = record.fields.map(field => {
    const binding = member(factory, identifier(factory, record.bindings), field.slot.text);
    const pointer = runtimeCall(factory, runtime, "requireBoundField", [], [member(factory, binding, field.key)]);
    return required(NewVariableStatement(factory, undefined, NewVariableDeclarationList(factory,
      list(factory, [required(NewVariableDeclaration(factory, identifier(factory, field.pointer), undefined, undefined, pointer), "field capture")]),
      NodeFlagsConst)), "field capture statement");
  });
  const view = object(factory, record.fields.flatMap(field => accessors(factory, field)));
  let identity = required(NewVoidExpression(factory, NewNumericLiteral(factory, "0", 0)), "absent field identity");
  for (const field of [...record.fields].reverse()) {
    const condition = required(NewBinaryExpression(factory, undefined, identifier(factory, record.key), undefined,
      NewToken(factory, KindEqualsEqualsEqualsToken), text(factory, field.key)), "selected field key");
    identity = required(NewConditionalExpression(factory, condition, NewToken(factory, KindQuestionToken),
      runtimeCall(factory, runtime, "boundFieldIdentity", [], [identifier(factory, field.pointer)]), NewToken(factory, KindColonToken), identity), "field identity selection");
  }
  const keyType = required(NewUnionTypeNode(factory, list(factory, [KindStringKeyword, KindNumberKeyword, KindSymbolKeyword]
    .map(kind => required(NewKeywordTypeNode(factory, kind), "property key kind")))), "property key type");
  const result = object(factory, [property(factory, "value", view), property(factory, "locations",
    required(NewArrayLiteralExpression(factory, list(factory, record.fields.map(field => identifier(factory, field.pointer))), false), "bound field identities")), property(factory, "identity",
    arrow(factory, [parameter(factory, record.key, keyType)], identity))]);
  const create = arrow(factory, [parameter(factory, record.bindings)], block(factory, [...declarations,
    required(NewReturnStatement(factory, result), "bound record construction")]));
  return runtimeCall(factory, runtime, "bindMemoryRecord", [], [object(factory, captured), create]);
}

function accessors(factory: NodeFactory, field: BoundMemoryField): Node[] {
  const pointer = identifier(factory, field.pointer);
  const valueType = required(NewIndexedAccessTypeNode(factory,
    NewTypeQueryNode(factory, pointer, undefined), NewLiteralTypeNode(factory, text(factory, "value"))), "bound field value type");
  const read = member(factory, pointer, "value");
  const write = required(NewBinaryExpression(factory, undefined, member(factory, pointer, "value"), undefined,
    NewToken(factory, KindEqualsToken), identifier(factory, field.value)), "bound field write");
  return [
    required(NewGetAccessorDeclaration(factory, undefined, text(factory, field.key), undefined, list(factory, []), valueType, undefined,
      block(factory, [required(NewReturnStatement(factory, read), "field load")])), "bound field getter"),
    required(NewSetAccessorDeclaration(factory, undefined, text(factory, field.key), undefined,
      list(factory, [parameter(factory, field.value, valueType)]), undefined, undefined,
      block(factory, [required(NewExpressionStatement(factory, write), "field store")])), "bound field setter"),
  ];
}

function property(factory: NodeFactory, key: string, value: Node): Node {
  return required(NewPropertyAssignment(factory, undefined, NewComputedPropertyName(factory, text(factory, key)), undefined, undefined, value), "bound record property");
}
function object(factory: NodeFactory, properties: Node[]): Node {
  return required(NewObjectLiteralExpression(factory, list(factory, properties), true), "bound record object");
}
function member(factory: NodeFactory, receiver: Node, key: string): Node {
  return required(NewElementAccessExpression(factory, receiver, undefined, text(factory, key), 0), "bound record member");
}
function identifier(factory: NodeFactory, name: GeneratedBindingName): Node {
  return required(NewIdentifier(factory, name.text), "bound record name");
}
function text(factory: NodeFactory, value: string): Node { return required(NewStringLiteral(factory, value, 0), "bound record key"); }
function list(factory: NodeFactory, nodes: Node[]) { return NodeFactory_NewNodeList(factory, nodes); }
function block(factory: NodeFactory, nodes: Node[]): Node { return required(NewBlock(factory, list(factory, nodes), true), "bound record block"); }
function parameter(factory: NodeFactory, name: GeneratedBindingName, type?: Node): Node {
  return required(NewParameterDeclaration(factory, undefined, undefined, identifier(factory, name), undefined, type, undefined), "bound record parameter");
}
function arrow(factory: NodeFactory, parameters: Node[], body: Node): Node {
  return required(NewArrowFunction(factory, undefined, undefined, list(factory, parameters), undefined, undefined,
    NewToken(factory, KindEqualsGreaterThanToken), body), "bound record closure");
}
