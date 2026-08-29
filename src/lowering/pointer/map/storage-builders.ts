import type { Node } from "@tsonic/tsts";
import {
  KindBooleanKeyword,
  KindColonToken,
  KindEqualsEqualsEqualsToken,
  KindEqualsToken,
  KindObjectKeyword,
  KindQuestionToken,
  KindThisKeyword,
  KindUndefinedKeyword,
  KindVoidKeyword,
  NewBinaryExpression,
  NewBlock,
  NewCallExpression,
  NewConditionalExpression,
  NewExpressionStatement,
  NewIdentifier,
  NewKeywordExpression,
  NewKeywordTypeNode,
  NewMethodDeclaration,
  NewNumericLiteral,
  NewObjectLiteralExpression,
  NewParameterDeclaration,
  NewPropertyAccessExpression,
  NewPropertyAssignment,
  NewPropertySignatureDeclaration,
  NewToken,
  NewTypeParameterDeclaration,
  NewTypeReferenceNode,
  NewUnionTypeNode,
  NewVariableDeclaration,
  NewVariableDeclarationList,
  NewVariableStatement,
  NodeFactory_NewNodeList,
} from "@tsonic/tsts/target-ast";
import type { NodeFactory } from "@tsonic/tsts/target-ast";

import { PointerLoweringError } from "../diagnostic.js";

export function method(
  factory: NodeFactory,
  name: string,
  parameters: readonly Node[],
  resultType: Node,
  statements: readonly Node[],
): Node {
  return required(
    NewMethodDeclaration(
      factory,
      undefined,
      undefined,
      identifier(factory, name),
      undefined,
      undefined,
      NodeFactory_NewNodeList(factory, [...parameters]),
      resultType,
      undefined,
      block(factory, statements),
    ),
    `canonical pointer-map ${name} method`,
  );
}

export function typeParameter(
  factory: NodeFactory,
  name: string,
  constraint?: Node,
): Node {
  return required(
    NewTypeParameterDeclaration(
      factory,
      undefined,
      identifier(factory, name),
      constraint,
      undefined,
      undefined,
    ),
    `canonical pointer-map type parameter ${name}`,
  );
}

export function propertySignature(
  factory: NodeFactory,
  name: string,
  type: Node,
): Node {
  return required(
    NewPropertySignatureDeclaration(
      factory,
      undefined,
      identifier(factory, name),
      undefined,
      type,
      undefined,
    ),
    `canonical pointer-map key property ${name}`,
  );
}

export function parameter(
  factory: NodeFactory,
  name: string,
  type: Node,
): Node {
  return required(
    NewParameterDeclaration(
      factory,
      undefined,
      undefined,
      identifier(factory, name),
      undefined,
      type,
      undefined,
    ),
    `canonical pointer-map parameter ${name}`,
  );
}

export function variable(
  factory: NodeFactory,
  flags: number,
  name: string,
  type: Node | undefined,
  initializer: Node,
): Node {
  const declaration = required(
    NewVariableDeclaration(
      factory,
      identifier(factory, name),
      undefined,
      type,
      initializer,
    ),
    `canonical pointer-map variable ${name}`,
  );
  const list = required(
    NewVariableDeclarationList(
      factory,
      NodeFactory_NewNodeList(factory, [declaration]),
      flags,
    ),
    `canonical pointer-map variable list ${name}`,
  );
  return required(
    NewVariableStatement(factory, undefined, list),
    `canonical pointer-map variable statement ${name}`,
  );
}

export function call(
  factory: NodeFactory,
  receiver: Node,
  name: string,
  arguments_: readonly Node[],
): Node {
  return required(
    NewCallExpression(
      factory,
      property(factory, receiver, name),
      undefined,
      undefined,
      NodeFactory_NewNodeList(factory, [...arguments_]),
      0,
    ),
    `canonical pointer-map call ${name}`,
  );
}

export function property(
  factory: NodeFactory,
  receiver: Node,
  name: string,
): Node {
  return required(
    NewPropertyAccessExpression(
      factory,
      receiver,
      undefined,
      identifier(factory, name),
      0,
    ),
    `canonical pointer-map property ${name}`,
  );
}

export function thisProperty(factory: NodeFactory, name: string): Node {
  return property(
    factory,
    required(
      NewKeywordExpression(factory, KindThisKeyword),
      "canonical pointer-map this expression",
    ),
    name,
  );
}

export function assignment(
  factory: NodeFactory,
  left: Node,
  right: Node,
): Node {
  return binary(factory, left, KindEqualsToken, right);
}

export function equals(factory: NodeFactory, left: Node, right: Node): Node {
  return binary(factory, left, KindEqualsEqualsEqualsToken, right);
}

export function isUndefined(factory: NodeFactory, value: Node): Node {
  return equals(factory, value, undefinedExpression(factory));
}

function binary(
  factory: NodeFactory,
  left: Node,
  operator: number,
  right: Node,
): Node {
  return required(
    NewBinaryExpression(
      factory,
      undefined,
      left,
      undefined,
      NewToken(factory, operator),
      right,
    ),
    "canonical pointer-map binary expression",
  );
}

export function conditional(
  factory: NodeFactory,
  condition: Node,
  whenTrue: Node,
  whenFalse: Node,
): Node {
  return required(
    NewConditionalExpression(
      factory,
      condition,
      NewToken(factory, KindQuestionToken),
      whenTrue,
      NewToken(factory, KindColonToken),
      whenFalse,
    ),
    "canonical pointer-map conditional expression",
  );
}

export function expressionStatement(
  factory: NodeFactory,
  expression: Node,
): Node {
  return required(
    NewExpressionStatement(factory, expression),
    "canonical pointer-map expression statement",
  );
}

export function objectLiteral(
  factory: NodeFactory,
  properties: readonly (readonly [string, Node])[],
): Node {
  return required(
    NewObjectLiteralExpression(
      factory,
      NodeFactory_NewNodeList(factory, properties.map(([name, value]) =>
        required(
          NewPropertyAssignment(
            factory,
            undefined,
            identifier(factory, name),
            undefined,
            undefined,
            value,
          ),
          `canonical pointer-map property assignment ${name}`,
        )
      )),
      false,
    ),
    "canonical pointer-map object literal",
  );
}

export function block(
  factory: NodeFactory,
  statements: readonly Node[],
): Node {
  return required(
    NewBlock(factory, NodeFactory_NewNodeList(factory, [...statements]), true),
    "canonical pointer-map block",
  );
}

export function typeReference(
  factory: NodeFactory,
  name: string,
  arguments_: readonly Node[] = [],
): Node {
  return required(
    NewTypeReferenceNode(
      factory,
      identifier(factory, name),
      arguments_.length === 0
        ? undefined
        : NodeFactory_NewNodeList(factory, [...arguments_]),
    ),
    `canonical pointer-map type ${name}`,
  );
}

export function unionType(factory: NodeFactory, types: readonly Node[]): Node {
  return required(
    NewUnionTypeNode(factory, NodeFactory_NewNodeList(factory, [...types])),
    "canonical pointer-map union type",
  );
}

export function objectType(factory: NodeFactory): Node {
  return required(
    NewKeywordTypeNode(factory, KindObjectKeyword),
    "canonical pointer-map object type",
  );
}

export function undefinedType(factory: NodeFactory): Node {
  return required(
    NewKeywordTypeNode(factory, KindUndefinedKeyword),
    "canonical pointer-map undefined type",
  );
}

export function booleanType(factory: NodeFactory): Node {
  return required(
    NewKeywordTypeNode(factory, KindBooleanKeyword),
    "canonical pointer-map boolean type",
  );
}

export function voidType(factory: NodeFactory): Node {
  return required(
    NewKeywordTypeNode(factory, KindVoidKeyword),
    "canonical pointer-map void type",
  );
}

export function undefinedExpression(factory: NodeFactory): Node {
  return identifier(factory, "undefined");
}

export function numeric(factory: NodeFactory, text: string): Node {
  return required(
    NewNumericLiteral(factory, text, 0),
    `canonical pointer-map numeric ${text}`,
  );
}

export function identifier(factory: NodeFactory, text: string): Node {
  return required(NewIdentifier(factory, text), `identifier ${text}`);
}

export function required<T>(value: T | undefined, subject: string): T {
  if (value === undefined) {
    throw new PointerLoweringError(`${subject} was not created`);
  }
  return value;
}
