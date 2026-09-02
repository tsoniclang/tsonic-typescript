import type { Node } from "@tsonic/tsts";
import {
  KindFalseKeyword,
  KindForOfStatement,
  NewArrayLiteralExpression,
  NewArrayTypeNode,
  NewIfStatement,
  NewKeywordExpression,
  NewNewExpression,
  NewPropertyDeclaration,
  NewReturnStatement,
  NewTypeLiteralNode,
  NewVariableDeclaration,
  NewVariableDeclarationList,
  NodeFactory_NewNodeList,
  NodeFlagsConst,
  NodeFlagsLet,
  NewForInOrOfStatement,
} from "@tsonic/tsts/target-ast";
import type { NodeFactory } from "@tsonic/tsts/target-ast";

import {
  assignment,
  block,
  booleanType,
  call,
  conditional,
  equals,
  expressionStatement,
  identifier,
  isUndefined,
  method,
  numeric,
  objectType,
  parameter,
  property,
  propertySignature,
  required,
  thisProperty,
  typeParameter,
  typeReference,
  undefinedExpression,
  undefinedType,
  unionType,
  variable,
  voidType,
} from "./storage-builders.js";

const keyTypeName = "K";
const valueTypeName = "V";
const identitiesName = "identities";
const orderedName = "ordered";
const keyName = "key";
const valueName = "value";
const identityName = "identity";
const storageKeyName = "storageKey";
const entriesName = "entries";
const entryName = "entry";
const deletedName = "deleted";
const resultName = "result";

export interface CanonicalPointerMapStorageShape {
  readonly typeParameters: readonly Node[];
  readonly members: readonly Node[];
}

export function canonicalPointerMapStorageShape(
  factory: NodeFactory,
): CanonicalPointerMapStorageShape {
  return Object.freeze({
    typeParameters: Object.freeze([
      typeParameter(factory, keyTypeName, pointerKeyConstraint(factory)),
      typeParameter(factory, valueTypeName),
    ]),
    members: Object.freeze([
      identitiesProperty(factory),
      orderedProperty(factory),
      getMethod(factory),
      insertMethod(factory),
      deleteMethod(factory),
      clearMethod(factory),
      keysMethod(factory),
    ]),
  });
}

function orderedProperty(factory: NodeFactory): Node {
  return required(
    NewPropertyDeclaration(
      factory,
      undefined,
      identifier(factory, orderedName),
      undefined,
      typeReference(factory, "Map", orderedTypeArguments(factory)),
      required(
        NewNewExpression(
          factory,
          identifier(factory, "Map"),
          NodeFactory_NewNodeList(factory, [...orderedTypeArguments(factory)]),
          NodeFactory_NewNodeList(factory, []),
        ),
        "canonical pointer-map ordered storage initializer",
      ),
    ),
    "canonical pointer-map ordered storage",
  );
}

function identitiesProperty(factory: NodeFactory): Node {
  return required(
    NewPropertyDeclaration(
      factory,
      undefined,
      identifier(factory, identitiesName),
      undefined,
      identitiesType(factory),
      required(
        NewNewExpression(
          factory,
          identifier(factory, "Map"),
          NodeFactory_NewNodeList(factory, [...identitiesTypeArguments(factory)]),
          NodeFactory_NewNodeList(factory, []),
        ),
        "canonical pointer-map identity storage initializer",
      ),
    ),
    "canonical pointer-map identity storage",
  );
}

function getMethod(factory: NodeFactory): Node {
  return method(
    factory,
    "get",
    [parameter(factory, keyName, typeReference(factory, keyTypeName))],
    unionType(factory, [entryType(factory), undefinedType(factory)]),
    [
      keyPartDeclaration(factory, identityName, "storageIdentity"),
      keyPartDeclaration(factory, storageKeyName, "storageKey"),
      variable(
        factory,
        NodeFlagsConst,
        entriesName,
        undefined,
        call(factory, thisProperty(factory, identitiesName), "get", [
          identifier(factory, identityName),
        ]),
      ),
      variable(
        factory,
        NodeFlagsConst,
        entryName,
        undefined,
        conditional(
          factory,
          isUndefined(factory, identifier(factory, entriesName)),
          undefinedExpression(factory),
          call(factory, identifier(factory, entriesName), "get", [
            identifier(factory, storageKeyName),
          ]),
        ),
      ),
      required(
        NewReturnStatement(
          factory,
          identifier(factory, entryName),
        ),
        "canonical pointer-map get return",
      ),
    ],
  );
}

function insertMethod(factory: NodeFactory): Node {
  return method(
    factory,
    "insert",
    [
      parameter(factory, keyName, typeReference(factory, keyTypeName)),
      parameter(factory, entryName, entryType(factory)),
    ],
    voidType(factory),
    [
      keyPartDeclaration(factory, identityName, "storageIdentity"),
      keyPartDeclaration(factory, storageKeyName, "storageKey"),
      variable(
        factory,
        NodeFlagsLet,
        entriesName,
        undefined,
        call(factory, thisProperty(factory, identitiesName), "get", [
          identifier(factory, identityName),
        ]),
      ),
      required(
        NewIfStatement(
          factory,
          isUndefined(factory, identifier(factory, entriesName)),
          block(factory, [
            expressionStatement(
              factory,
              assignment(
                factory,
                identifier(factory, entriesName),
                required(
                  NewNewExpression(
                    factory,
                    identifier(factory, "Map"),
                    NodeFactory_NewNodeList(factory, [...innerTypeArguments(factory)]),
                    NodeFactory_NewNodeList(factory, []),
                  ),
                  "canonical pointer-map inner storage",
                ),
              ),
            ),
            expressionStatement(
              factory,
              call(factory, thisProperty(factory, identitiesName), "set", [
                identifier(factory, identityName),
                identifier(factory, entriesName),
              ]),
            ),
          ]),
          undefined,
        ),
        "canonical pointer-map set initialization",
      ),
      expressionStatement(
        factory,
        call(factory, identifier(factory, entriesName), "set", [
          identifier(factory, storageKeyName),
          identifier(factory, entryName),
        ]),
      ),
      expressionStatement(
        factory,
        call(factory, thisProperty(factory, orderedName), "set", [
          identifier(factory, entryName),
          undefinedExpression(factory),
        ]),
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
      keyPartDeclaration(factory, identityName, "storageIdentity"),
      keyPartDeclaration(factory, storageKeyName, "storageKey"),
      variable(
        factory,
        NodeFlagsConst,
        entriesName,
        undefined,
        call(factory, thisProperty(factory, identitiesName), "get", [
          identifier(factory, identityName),
        ]),
      ),
      required(
        NewIfStatement(
          factory,
          isUndefined(factory, identifier(factory, entriesName)),
          block(factory, [
            required(
              NewReturnStatement(factory, falseExpression(factory)),
              "canonical pointer-map absent delete",
            ),
          ]),
          undefined,
        ),
        "canonical pointer-map absent delete branch",
      ),
      variable(
        factory,
        NodeFlagsConst,
        entryName,
        undefined,
        call(factory, identifier(factory, entriesName), "get", [
          identifier(factory, storageKeyName),
        ]),
      ),
      required(
        NewIfStatement(
          factory,
          isUndefined(factory, identifier(factory, entryName)),
          block(factory, [
            required(
              NewReturnStatement(factory, falseExpression(factory)),
              "canonical pointer-map missing-key delete",
            ),
          ]),
          undefined,
        ),
        "canonical pointer-map missing-key delete branch",
      ),
      variable(
        factory,
        NodeFlagsConst,
        deletedName,
        undefined,
        call(factory, identifier(factory, entriesName), "delete", [
          identifier(factory, storageKeyName),
        ]),
      ),
      required(
        NewIfStatement(
          factory,
          identifier(factory, deletedName),
          block(factory, [
            expressionStatement(
              factory,
              call(factory, thisProperty(factory, orderedName), "delete", [
                identifier(factory, entryName),
              ]),
            ),
          ]),
          undefined,
        ),
        "canonical pointer-map ordered delete",
      ),
      required(
        NewIfStatement(
          factory,
          equals(
            factory,
            property(factory, identifier(factory, entriesName), "size"),
            numeric(factory, "0"),
          ),
          block(factory, [
            expressionStatement(
              factory,
              call(factory, thisProperty(factory, identitiesName), "delete", [
                identifier(factory, identityName),
              ]),
            ),
          ]),
          undefined,
        ),
        "canonical pointer-map empty identity cleanup",
      ),
      required(
        NewReturnStatement(factory, identifier(factory, deletedName)),
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
        call(factory, thisProperty(factory, identitiesName), "clear", []),
      ),
      expressionStatement(
        factory,
        call(factory, thisProperty(factory, orderedName), "clear", []),
      ),
    ],
  );
}

function keysMethod(factory: NodeFactory): Node {
  return method(
    factory,
    "keys",
    [],
    required(
      NewArrayTypeNode(factory, typeReference(factory, keyTypeName)),
      "canonical pointer-map keys type",
    ),
    [
      variable(
        factory,
        NodeFlagsConst,
        resultName,
        required(
          NewArrayTypeNode(factory, typeReference(factory, keyTypeName)),
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
      keysLoop(factory),
      required(
        NewReturnStatement(factory, identifier(factory, resultName)),
        "canonical pointer-map keys return",
      ),
    ],
  );
}

function keysLoop(factory: NodeFactory): Node {
  const declaration = required(
    NewVariableDeclaration(
      factory,
      identifier(factory, entryName),
      undefined,
      undefined,
      undefined,
    ),
    "canonical pointer-map keys binding",
  );
  const initializer = required(
    NewVariableDeclarationList(
      factory,
      NodeFactory_NewNodeList(factory, [declaration]),
      NodeFlagsConst,
    ),
    "canonical pointer-map keys binding list",
  );
  return required(
    NewForInOrOfStatement(
      factory,
      KindForOfStatement,
      undefined,
      initializer,
      call(factory, thisProperty(factory, orderedName), "keys", []),
      block(factory, [
        expressionStatement(
          factory,
          call(factory, identifier(factory, resultName), "push", [
            property(factory, identifier(factory, entryName), keyName),
          ]),
        ),
      ]),
    ),
    "canonical pointer-map keys loop",
  );
}

function pointerKeyConstraint(factory: NodeFactory): Node {
  const locationShape = required(
    NewTypeLiteralNode(
      factory,
      NodeFactory_NewNodeList(factory, [
        propertySignature(factory, "storageIdentity", objectType(factory)),
        propertySignature(
          factory,
          "storageKey",
          unionType(factory, [
            typeReference(factory, "PropertyKey"),
            undefinedType(factory),
          ]),
        ),
      ]),
    ),
    "canonical pointer-map key shape",
  );
  return unionType(factory, [locationShape, undefinedType(factory)]);
}

function identitiesType(factory: NodeFactory): Node {
  return typeReference(factory, "Map", identitiesTypeArguments(factory));
}

function identitiesTypeArguments(factory: NodeFactory): readonly Node[] {
  return [
    unionType(factory, [objectType(factory), undefinedType(factory)]),
    typeReference(factory, "Map", innerTypeArguments(factory)),
  ];
}

function innerTypeArguments(factory: NodeFactory): readonly Node[] {
  return [
    unionType(factory, [
      typeReference(factory, "PropertyKey"),
      undefinedType(factory),
    ]),
    entryType(factory),
  ];
}

function orderedTypeArguments(factory: NodeFactory): readonly Node[] {
  return [entryType(factory), undefinedType(factory)];
}

export function canonicalPointerMapEntryType(
  factory: NodeFactory,
  keyType: Node,
  valueType: Node,
): Node {
  return required(
    NewTypeLiteralNode(
      factory,
      NodeFactory_NewNodeList(factory, [
        propertySignature(factory, keyName, keyType),
        propertySignature(factory, valueName, valueType),
      ]),
    ),
    "canonical pointer-map entry type",
  );
}

function entryType(factory: NodeFactory): Node {
  return required(
    NewTypeLiteralNode(
      factory,
      NodeFactory_NewNodeList(factory, [
        propertySignature(
          factory,
          keyName,
          typeReference(factory, keyTypeName),
        ),
        propertySignature(
          factory,
          valueName,
          typeReference(factory, valueTypeName),
        ),
      ]),
    ),
    "canonical pointer-map ordered entry type",
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
    conditional(
      factory,
      isUndefined(factory, identifier(factory, keyName)),
      undefinedExpression(factory),
      property(factory, identifier(factory, keyName), propertyName),
    ),
  );
}

function falseExpression(factory: NodeFactory): Node {
  return required(
    NewKeywordExpression(factory, KindFalseKeyword),
    "canonical pointer-map false expression",
  );
}
