import type { Node } from "@tsonic/tsts";
import {
  KindFalseKeyword,
  KindForOfStatement,
  NewArrayLiteralExpression,
  NewArrayTypeNode,
  NewForInOrOfStatement,
  NewIfStatement,
  NewKeywordExpression,
  NewNewExpression,
  NewReturnStatement,
  NewVariableDeclaration,
  NewVariableDeclarationList,
  NodeFactory_NewNodeList,
  NodeFlagsConst,
  NodeFlagsLet,
} from "@tsonic/tsts/target-ast";
import type { NodeFactory } from "@tsonic/tsts/target-ast";

import {
  assignment,
  block,
  booleanType,
  call,
  equals,
  expressionStatement,
  identifier,
  isUndefined,
  method,
  numeric,
  objectLiteral,
  objectType,
  parameter,
  property,
  required,
  thisProperty,
  typeReference,
  undefinedExpression,
  undefinedType,
  unionType,
  variable,
  voidType,
} from "./storage-builders.js";

const keyTypeName = "K";
const valueTypeName = "V";
const valuesName = "entries";
const propertyIdentitiesName = "propertyIdentities";
const keyName = "key";
const valueName = "value";
const identityName = "identity";
const storageIdentityName = "storageIdentity";
const storageKeyName = "storageKey";
const identitiesName = "identities";
const deletedName = "deleted";
const resultName = "result";

export function canonicalPointerMapStorageMethods(
  factory: NodeFactory,
): readonly Node[] {
  return Object.freeze([
    getMethod(factory),
    setMethod(factory),
    deleteMethod(factory),
    clearMethod(factory),
    valuesMethod(factory),
  ]);
}

function getMethod(factory: NodeFactory): Node {
  return method(
    factory,
    "get",
    [parameter(factory, keyName, typeReference(factory, keyTypeName))],
    unionType(factory, [typeReference(factory, valueTypeName), undefinedType(factory)]),
    [
      returnNilKey(factory, "get"),
      keyPartDeclaration(factory, storageIdentityName, "storageIdentity"),
      keyPartDeclaration(factory, storageKeyName, "storageKey"),
      required(
        NewIfStatement(
          factory,
          isUndefined(factory, identifier(factory, storageKeyName)),
          block(factory, [
            returnMapCall(
              factory,
              valuesName,
              "get",
              identifier(factory, storageIdentityName),
              "canonical pointer-map direct get",
            ),
          ]),
          undefined,
        ),
        "canonical pointer-map direct get branch",
      ),
      propertyIdentitiesDeclaration(factory, NodeFlagsConst),
      returnUndefinedWhenAbsent(factory, identitiesName),
      variable(
        factory,
        NodeFlagsConst,
        identityName,
        undefined,
        call(factory, identifier(factory, identitiesName), "get", [
          identifier(factory, storageKeyName),
        ]),
      ),
      returnUndefinedWhenAbsent(factory, identityName),
      returnMapCall(
        factory,
        valuesName,
        "get",
        identifier(factory, identityName),
        "canonical pointer-map property get",
      ),
    ],
  );
}

function setMethod(factory: NodeFactory): Node {
  return method(
    factory,
    "set",
    [
      parameter(factory, keyName, typeReference(factory, keyTypeName)),
      parameter(factory, valueName, typeReference(factory, valueTypeName)),
    ],
    voidType(factory),
    [
      setAndReturnWhenNil(factory),
      keyPartDeclaration(factory, storageIdentityName, "storageIdentity"),
      keyPartDeclaration(factory, storageKeyName, "storageKey"),
      required(
        NewIfStatement(
          factory,
          isUndefined(factory, identifier(factory, storageKeyName)),
          block(factory, [
            mapSet(
              factory,
              valuesName,
              identifier(factory, storageIdentityName),
              identifier(factory, valueName),
            ),
            returnStatement(factory, undefined, "canonical pointer-map direct set return"),
          ]),
          undefined,
        ),
        "canonical pointer-map direct set branch",
      ),
      propertyIdentitiesDeclaration(factory, NodeFlagsLet),
      required(
        NewIfStatement(
          factory,
          isUndefined(factory, identifier(factory, identitiesName)),
          block(factory, [
            expressionStatement(
              factory,
              assignment(
                factory,
                identifier(factory, identitiesName),
                newPropertyIdentityMap(factory),
              ),
            ),
            mapSet(
              factory,
              propertyIdentitiesName,
              identifier(factory, storageIdentityName),
              identifier(factory, identitiesName),
            ),
          ]),
          undefined,
        ),
        "canonical pointer-map property identity initialization",
      ),
      variable(
        factory,
        NodeFlagsLet,
        identityName,
        undefined,
        call(factory, identifier(factory, identitiesName), "get", [
          identifier(factory, storageKeyName),
        ]),
      ),
      required(
        NewIfStatement(
          factory,
          isUndefined(factory, identifier(factory, identityName)),
          block(factory, [
            expressionStatement(
              factory,
              assignment(
                factory,
                identifier(factory, identityName),
                objectLiteral(factory, []),
              ),
            ),
            expressionStatement(
              factory,
              call(factory, identifier(factory, identitiesName), "set", [
                identifier(factory, storageKeyName),
                identifier(factory, identityName),
              ]),
            ),
          ]),
          undefined,
        ),
        "canonical pointer-map property token initialization",
      ),
      mapSet(
        factory,
        valuesName,
        identifier(factory, identityName),
        identifier(factory, valueName),
      ),
    ],
  );
}

function deleteMethod(factory: NodeFactory): Node {
  return method(
    factory,
    "delete",
    [parameter(factory, keyName, typeReference(factory, keyTypeName))],
    booleanType(factory),
    [
      returnNilKey(factory, "delete"),
      keyPartDeclaration(factory, storageIdentityName, "storageIdentity"),
      keyPartDeclaration(factory, storageKeyName, "storageKey"),
      required(
        NewIfStatement(
          factory,
          isUndefined(factory, identifier(factory, storageKeyName)),
          block(factory, [
            returnMapCall(
              factory,
              valuesName,
              "delete",
              identifier(factory, storageIdentityName),
              "canonical pointer-map direct delete",
            ),
          ]),
          undefined,
        ),
        "canonical pointer-map direct delete branch",
      ),
      propertyIdentitiesDeclaration(factory, NodeFlagsConst),
      returnFalseWhenAbsent(factory, identitiesName),
      variable(
        factory,
        NodeFlagsConst,
        identityName,
        undefined,
        call(factory, identifier(factory, identitiesName), "get", [
          identifier(factory, storageKeyName),
        ]),
      ),
      returnFalseWhenAbsent(factory, identityName),
      variable(
        factory,
        NodeFlagsConst,
        deletedName,
        undefined,
        call(factory, thisProperty(factory, valuesName), "delete", [
          identifier(factory, identityName),
        ]),
      ),
      required(
        NewIfStatement(
          factory,
          identifier(factory, deletedName),
          block(factory, [
            expressionStatement(
              factory,
              call(factory, identifier(factory, identitiesName), "delete", [
                identifier(factory, storageKeyName),
              ]),
            ),
            deleteEmptyPropertyRegistry(factory),
          ]),
          undefined,
        ),
        "canonical pointer-map property token cleanup",
      ),
      returnStatement(
        factory,
        identifier(factory, deletedName),
        "canonical pointer-map delete return",
      ),
    ],
  );
}

function clearMethod(factory: NodeFactory): Node {
  return method(
    factory,
    "clear",
    [],
    voidType(factory),
    [
      expressionStatement(
        factory,
        call(factory, thisProperty(factory, valuesName), "clear", []),
      ),
      expressionStatement(
        factory,
        call(factory, thisProperty(factory, propertyIdentitiesName), "clear", []),
      ),
    ],
  );
}

function valuesMethod(factory: NodeFactory): Node {
  return method(
    factory,
    "values",
    [],
    required(
      NewArrayTypeNode(factory, typeReference(factory, valueTypeName)),
      "canonical pointer-map values type",
    ),
    [
      variable(
        factory,
        NodeFlagsConst,
        resultName,
        required(
          NewArrayTypeNode(factory, typeReference(factory, valueTypeName)),
          "canonical pointer-map result type",
        ),
        required(
          NewArrayLiteralExpression(
            factory,
            NodeFactory_NewNodeList(factory, []),
            false,
          ),
          "canonical pointer-map result",
        ),
      ),
      valuesLoop(factory),
      returnStatement(
        factory,
        identifier(factory, resultName),
        "canonical pointer-map values return",
      ),
    ],
  );
}

function returnNilKey(factory: NodeFactory, operation: "get" | "delete"): Node {
  return required(
    NewIfStatement(
      factory,
      isUndefined(factory, identifier(factory, keyName)),
      block(factory, [
        returnMapCall(
          factory,
          valuesName,
          operation,
          undefinedExpression(factory),
          `canonical pointer-map nil ${operation}`,
        ),
      ]),
      undefined,
    ),
    `canonical pointer-map nil ${operation} branch`,
  );
}

function setAndReturnWhenNil(factory: NodeFactory): Node {
  return required(
    NewIfStatement(
      factory,
      isUndefined(factory, identifier(factory, keyName)),
      block(factory, [
        mapSet(
          factory,
          valuesName,
          undefinedExpression(factory),
          identifier(factory, valueName),
        ),
        returnStatement(factory, undefined, "canonical pointer-map nil set return"),
      ]),
      undefined,
    ),
    "canonical pointer-map nil set branch",
  );
}

function keyPartDeclaration(
  factory: NodeFactory,
  localName: string,
  propertyName: string,
): Node {
  return variable(
    factory,
    NodeFlagsConst,
    localName,
    undefined,
    property(factory, identifier(factory, keyName), propertyName),
  );
}

function propertyIdentitiesDeclaration(
  factory: NodeFactory,
  flags: number,
): Node {
  return variable(
    factory,
    flags,
    identitiesName,
    undefined,
    call(factory, thisProperty(factory, propertyIdentitiesName), "get", [
      identifier(factory, storageIdentityName),
    ]),
  );
}

function newPropertyIdentityMap(factory: NodeFactory): Node {
  const arguments_ = [typeReference(factory, "PropertyKey"), objectType(factory)];
  return required(
    NewNewExpression(
      factory,
      identifier(factory, "Map"),
      NodeFactory_NewNodeList(factory, arguments_),
      NodeFactory_NewNodeList(factory, []),
    ),
    "canonical pointer-map property identity map",
  );
}

function mapSet(
  factory: NodeFactory,
  mapName: string,
  key: Node,
  value: Node,
): Node {
  return expressionStatement(
    factory,
    call(factory, thisProperty(factory, mapName), "set", [key, value]),
  );
}

function returnMapCall(
  factory: NodeFactory,
  mapName: string,
  operation: "get" | "delete",
  key: Node,
  subject: string,
): Node {
  return returnStatement(
    factory,
    call(factory, thisProperty(factory, mapName), operation, [key]),
    subject,
  );
}

function returnUndefinedWhenAbsent(factory: NodeFactory, name: string): Node {
  return required(
    NewIfStatement(
      factory,
      isUndefined(factory, identifier(factory, name)),
      block(factory, [
        returnStatement(
          factory,
          undefinedExpression(factory),
          `canonical pointer-map absent ${name}`,
        ),
      ]),
      undefined,
    ),
    `canonical pointer-map absent ${name} branch`,
  );
}

function returnFalseWhenAbsent(factory: NodeFactory, name: string): Node {
  return required(
    NewIfStatement(
      factory,
      isUndefined(factory, identifier(factory, name)),
      block(factory, [
        returnStatement(
          factory,
          falseExpression(factory),
          `canonical pointer-map missing ${name}`,
        ),
      ]),
      undefined,
    ),
    `canonical pointer-map missing ${name} branch`,
  );
}

function deleteEmptyPropertyRegistry(factory: NodeFactory): Node {
  return required(
    NewIfStatement(
      factory,
      equals(
        factory,
        property(factory, identifier(factory, identitiesName), "size"),
        numeric(factory, "0"),
      ),
      block(factory, [
        expressionStatement(
          factory,
          call(factory, thisProperty(factory, propertyIdentitiesName), "delete", [
            identifier(factory, storageIdentityName),
          ]),
        ),
      ]),
      undefined,
    ),
    "canonical pointer-map empty property identity cleanup",
  );
}

function valuesLoop(factory: NodeFactory): Node {
  const declaration = required(
    NewVariableDeclaration(
      factory,
      identifier(factory, valueName),
      undefined,
      undefined,
      undefined,
    ),
    "canonical pointer-map values binding",
  );
  const initializer = required(
    NewVariableDeclarationList(
      factory,
      NodeFactory_NewNodeList(factory, [declaration]),
      NodeFlagsConst,
    ),
    "canonical pointer-map values binding list",
  );
  return required(
    NewForInOrOfStatement(
      factory,
      KindForOfStatement,
      undefined,
      initializer,
      call(factory, thisProperty(factory, valuesName), "values", []),
      block(factory, [
        expressionStatement(
          factory,
          call(factory, identifier(factory, resultName), "push", [
            identifier(factory, valueName),
          ]),
        ),
      ]),
    ),
    "canonical pointer-map values loop",
  );
}

function returnStatement(
  factory: NodeFactory,
  expression: Node | undefined,
  subject: string,
): Node {
  return required(NewReturnStatement(factory, expression), subject);
}

function falseExpression(factory: NodeFactory): Node {
  return required(
    NewKeywordExpression(factory, KindFalseKeyword),
    "canonical pointer-map false expression",
  );
}
