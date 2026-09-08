import type { Node } from "@tsonic/tsts";
import {
  AsArrowFunction, AsCallExpression, AsFunctionExpression, AsParameterDeclaration,
  KindEqualsGreaterThanToken, NewArrayLiteralExpression, NewArrowFunction, NewBlock,
  NewCallExpression, NewExpressionStatement, NewGetAccessorDeclaration, NewIdentifier,
  NewIndexedAccessTypeNode, NewLiteralTypeNode, NewNumericLiteral, NewObjectLiteralExpression,
  NewParameterDeclaration, NewParenthesizedExpression, NewPropertyAccessExpression,
  NewReturnStatement, NewSetAccessorDeclaration, NewStringLiteral, NewToken, NodeFactory_NewNodeList,
} from "@tsonic/tsts/target-ast";
import type { NodeFactory } from "@tsonic/tsts/target-ast";
import type { GeneratedBindingName } from "../../generated-names.js";
import { PointerLoweringError } from "../diagnostic.js";
import { requiredRuntimeNode as required, runtimeCall, runtimeType } from "../runtime-ast.js";
import type { RecordMemoryField, RecordMemoryLayout } from "./record-plan.js";

export function rewriteRecordField(factory: NodeFactory, field: RecordMemoryField, updated: Node, runtime: GeneratedBindingName): Node {
  const call = AsCallExpression(updated);
  const selector = call?.Arguments?.Nodes[0];
  const functionNode = selector === undefined ? undefined : AsArrowFunction(selector) ?? AsFunctionExpression(selector);
  const parameter = functionNode?.Parameters?.Nodes[0];
  const owner = parameter === undefined ? undefined : AsParameterDeclaration(parameter)?.Type;
  const child = call?.Arguments?.Nodes[3];
  if (owner === undefined || child === undefined) {
    throw new PointerLoweringError("record field lost its authored owner type or child descriptor");
  }
  return runtimeCall(factory, runtime, "recordField", [owner, literalType(factory, field.key)], [
    text(factory, field.key), number(factory, field.fact.byteOffset), child,
  ]);
}

export function rewriteRecordLayout(factory: NodeFactory, layout: RecordMemoryLayout, updated: Node, runtime: GeneratedBindingName): Node {
  const call = AsCallExpression(updated);
  const owner = call?.TypeArguments?.Nodes[0];
  const fields = call?.Arguments?.Nodes.slice(4) ?? [];
  if (owner === undefined || fields.length !== layout.fields.length || fields.some(field => field === undefined)) {
    throw new PointerLoweringError("record layout lost its exact authored type or field set");
  }
  const parameters = layout.fields.map(field => parameter(factory, field.binding,
    runtimeType(factory, runtime, "RecordField", [owner, literalType(factory, field.key)])));
  const members = layout.fields.flatMap(field => fieldAccessors(factory, owner, layout, field));
  const view = arrow(factory, [parameter(factory, layout.accessBinding, runtimeType(factory, runtime, "MemoryAccess", []))],
    required(NewParenthesizedExpression(factory, NewObjectLiteralExpression(factory, list(factory, members), true)), "record view"));
  const body = runtimeCall(factory, runtime, "recordLayout", [owner], [
    text(factory, layout.fact.dataLayout.byteOrder), number(factory, layout.fact.byteSize),
    number(factory, layout.fact.byteAlignment), number(factory, layout.fact.stride),
    required(NewArrayLiteralExpression(factory, list(factory, layout.fields.map(field => identifier(factory, field.binding))), false), "record fields"),
    view,
  ]);
  return required(NewCallExpression(factory,
    NewParenthesizedExpression(factory, arrow(factory, parameters, body)), undefined, undefined,
    list(factory, fields.map(field => required(field, "record field"))), 0), "captured record layout");
}

function fieldAccessors(factory: NodeFactory, owner: Node, layout: RecordMemoryLayout, field: RecordMemoryField): Node[] {
  const fieldType = required(NewIndexedAccessTypeNode(factory, owner, literalType(factory, field.key)), "record field type");
  const descriptor = required(NewPropertyAccessExpression(factory, identifier(factory, field.binding), undefined,
    NewIdentifier(factory, "layout"), 0), "captured field codec");
  const read = accessCall(factory, layout.accessBinding, "read", [number(factory, field.fact.byteOffset), descriptor]);
  const write = accessCall(factory, layout.accessBinding, "write", [number(factory, field.fact.byteOffset), descriptor,
    identifier(factory, field.valueBinding)]);
  return [
    required(NewGetAccessorDeclaration(factory, undefined, text(factory, field.key), undefined, list(factory, []), fieldType, undefined,
      block(factory, [required(NewReturnStatement(factory, read), "record field read")])), "record getter"),
    required(NewSetAccessorDeclaration(factory, undefined, text(factory, field.key), undefined,
      list(factory, [parameter(factory, field.valueBinding, fieldType)]), undefined, undefined,
      block(factory, [required(NewExpressionStatement(factory, write), "record field write")])), "record setter"),
  ];
}

function accessCall(factory: NodeFactory, owner: GeneratedBindingName, member: string, args: Node[]): Node {
  return required(NewCallExpression(factory, NewPropertyAccessExpression(factory, identifier(factory, owner), undefined,
    NewIdentifier(factory, member), 0), undefined, undefined, list(factory, args), 0), "record memory access");
}

function arrow(factory: NodeFactory, parameters: Node[], body: Node): Node {
  return required(NewArrowFunction(factory, undefined, undefined, list(factory, parameters), undefined, undefined,
    NewToken(factory, KindEqualsGreaterThanToken), body), "record closure");
}

function parameter(factory: NodeFactory, name: GeneratedBindingName, type: Node): Node {
  return required(NewParameterDeclaration(factory, undefined, undefined, identifier(factory, name), undefined, type, undefined), "record parameter");
}

function identifier(factory: NodeFactory, name: GeneratedBindingName): Node {
  return required(NewIdentifier(factory, name.text), "record binding");
}

function literalType(factory: NodeFactory, value: string): Node {
  return required(NewLiteralTypeNode(factory, text(factory, value)), "record key type");
}

function text(factory: NodeFactory, value: string): Node {
  return required(NewStringLiteral(factory, value, 0), "record key");
}

function number(factory: NodeFactory, value: number): Node {
  return required(NewNumericLiteral(factory, String(value), 0), "record dimension");
}

function block(factory: NodeFactory, statements: Node[]): Node {
  return required(NewBlock(factory, list(factory, statements), true), "record block");
}

function list(factory: NodeFactory, nodes: Node[]) {
  return NodeFactory_NewNodeList(factory, nodes);
}
