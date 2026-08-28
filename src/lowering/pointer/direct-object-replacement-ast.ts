import type { Node } from "@tsonic/tsts";
import {
  AsClassDeclaration,
  KindEqualsToken,
  KindThisKeyword,
  KindVoidKeyword,
  NewBinaryExpression,
  NewBlock,
  NewCallExpression,
  NewExpressionStatement,
  NewIdentifier,
  NewKeywordExpression,
  NewKeywordTypeNode,
  NewMethodDeclaration,
  NewParameterDeclaration,
  NewPropertyAccessExpression,
  NewToken,
  NewTypeReferenceNode,
  NodeFactory_NewNodeList,
  NodeFactory_UpdateClassDeclaration,
} from "@tsonic/tsts/target-ast";
import type { NodeFactory } from "@tsonic/tsts/target-ast";

import { PointerLoweringError } from "./diagnostic.js";
import type { DirectObjectReplacement } from "./direct-object-replacement.js";

export function appendDirectObjectReplacementMethod(
  factory: NodeFactory,
  updated: Node,
  replacement: DirectObjectReplacement,
): Node {
  const declaration = AsClassDeclaration(updated);
  if (declaration?.name === undefined || declaration.Members === undefined) {
    throw new PointerLoweringError(
      "direct-object replacement class lost its exact declaration shape",
    );
  }
  const method = replacementMethod(factory, replacement);
  return requiredNode(
    NodeFactory_UpdateClassDeclaration(
      factory,
      declaration,
      declaration.modifiers,
      declaration.name,
      declaration.TypeParameters,
      declaration.HeritageClauses,
      NodeFactory_NewNodeList(factory, [
        ...declaration.Members.Nodes,
        method,
      ]),
    ),
    "class with direct-object replacement method",
  );
}

export function lowerDirectObjectReplacementStore(
  factory: NodeFactory,
  pointer: Node,
  value: Node,
  replacement: DirectObjectReplacement,
): Node {
  const target = requiredNode(
    NewPropertyAccessExpression(
      factory,
      pointer,
      undefined,
      NewIdentifier(factory, replacement.methodName.text),
      0,
    ),
    "direct-object replacement method access",
  );
  return requiredNode(
    NewCallExpression(
      factory,
      target,
      undefined,
      undefined,
      NodeFactory_NewNodeList(factory, [value]),
      0,
    ),
    "direct-object replacement call",
  );
}

function replacementMethod(
  factory: NodeFactory,
  replacement: DirectObjectReplacement,
): Node {
  const valueName = "$value";
  const parameter = requiredNode(
    NewParameterDeclaration(
      factory,
      undefined,
      undefined,
      NewIdentifier(factory, valueName),
      undefined,
      replacementClassType(factory, replacement),
      undefined,
    ),
    "direct-object replacement parameter",
  );
  const statements = replacement.fields.map((field) => requiredNode(
    NewExpressionStatement(
      factory,
      requiredNode(
        NewBinaryExpression(
          factory,
          undefined,
          property(factory, thisExpression(factory), field.name),
          undefined,
          NewToken(factory, KindEqualsToken),
          property(
            factory,
            requiredNode(
              NewIdentifier(factory, valueName),
              "direct-object replacement value identifier",
            ),
            field.name,
          ),
        ),
        `direct-object replacement assignment ${field.name}`,
      ),
    ),
    `direct-object replacement statement ${field.name}`,
  ));
  const body = requiredNode(
    NewBlock(
      factory,
      NodeFactory_NewNodeList(factory, statements),
      true,
    ),
    "direct-object replacement body",
  );
  return requiredNode(
    NewMethodDeclaration(
      factory,
      undefined,
      undefined,
      NewIdentifier(factory, replacement.methodName.text),
      undefined,
      undefined,
      NodeFactory_NewNodeList(factory, [parameter]),
      requiredNode(
        NewKeywordTypeNode(factory, KindVoidKeyword),
        "direct-object replacement return type",
      ),
      undefined,
      body,
    ),
    "direct-object replacement method",
  );
}

function replacementClassType(
  factory: NodeFactory,
  replacement: DirectObjectReplacement,
): Node {
  const typeArguments = replacement.typeParameterNames.map((name) =>
    requiredNode(
      NewTypeReferenceNode(
        factory,
        NewIdentifier(factory, name),
        undefined,
      ),
      `direct-object replacement type parameter ${name}`,
    )
  );
  return requiredNode(
    NewTypeReferenceNode(
      factory,
      NewIdentifier(factory, replacement.className),
      typeArguments.length === 0
        ? undefined
        : NodeFactory_NewNodeList(factory, typeArguments),
    ),
    "direct-object replacement class type",
  );
}

function property(factory: NodeFactory, receiver: Node, name: string): Node {
  return requiredNode(
    NewPropertyAccessExpression(
      factory,
      receiver,
      undefined,
      NewIdentifier(factory, name),
      0,
    ),
    `direct-object replacement field ${name}`,
  );
}

function thisExpression(factory: NodeFactory): Node {
  return requiredNode(
    NewKeywordExpression(factory, KindThisKeyword),
    "direct-object replacement this expression",
  );
}

function requiredNode(node: Node | undefined, subject: string): Node {
  if (node === undefined) {
    throw new PointerLoweringError(`${subject} was not created`);
  }
  return node;
}
