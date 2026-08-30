import type { Node } from "@tsonic/tsts";
import {
  KindForOfStatement,
  NewArrayLiteralExpression,
  NewArrayTypeNode,
  NewForInOrOfStatement,
  NewIfStatement,
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
  conditional,
  equals,
  expressionStatement,
  identifier,
  isUndefined,
  method,
  numeric,
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
} from "../storage-builders.js";
import {
  canonicalPointerMapNames as names,
  entryType,
  falseExpression,
  keyPartDeclaration,
  propertyEntriesTypeArguments,
} from "./model-ast.js";

export function getMethod(factory: NodeFactory): Node {
  return method(
    factory,
    "get",
    [parameter(factory, names.key, typeReference(factory, names.keyType))],
    unionType(factory, [entryType(factory), undefinedType(factory)]),
    [
      keyPartDeclaration(factory, names.identity, "storageIdentity"),
      keyPartDeclaration(factory, names.storageKey, "storageKey"),
      rootGetBranch(factory),
      variable(
        factory,
        NodeFlagsConst,
        names.entries,
        undefined,
        call(factory, thisProperty(factory, names.properties), "get", [
          identifier(factory, names.identity),
        ]),
      ),
      required(
        NewReturnStatement(
          factory,
          conditional(
            factory,
            isUndefined(factory, identifier(factory, names.entries)),
            undefinedExpression(factory),
            call(factory, identifier(factory, names.entries), "get", [
              identifier(factory, names.storageKey),
            ]),
          ),
        ),
        "canonical pointer-map property get return",
      ),
    ],
  );
}

export function insertMethod(factory: NodeFactory): Node {
  return method(
    factory,
    "insert",
    [
      parameter(factory, names.key, typeReference(factory, names.keyType)),
      parameter(factory, names.entry, entryType(factory)),
    ],
    voidType(factory),
    [
      keyPartDeclaration(factory, names.identity, "storageIdentity"),
      keyPartDeclaration(factory, names.storageKey, "storageKey"),
      rootInsertBranch(factory),
      variable(
        factory,
        NodeFlagsLet,
        names.entries,
        undefined,
        call(factory, thisProperty(factory, names.properties), "get", [
          identifier(factory, names.identity),
        ]),
      ),
      propertyEntriesInitialization(factory),
      expressionStatement(
        factory,
        call(factory, identifier(factory, names.entries), "set", [
          identifier(factory, names.storageKey),
          identifier(factory, names.entry),
        ]),
      ),
      orderedInsert(factory),
    ],
  );
}

export function deleteMethod(factory: NodeFactory): Node {
  return method(
    factory,
    "delete",
    [parameter(factory, names.key, typeReference(factory, names.keyType))],
    booleanType(factory),
    [
      keyPartDeclaration(factory, names.identity, "storageIdentity"),
      keyPartDeclaration(factory, names.storageKey, "storageKey"),
      rootDeleteBranch(factory),
      variable(
        factory,
        NodeFlagsConst,
        names.entries,
        undefined,
        call(factory, thisProperty(factory, names.properties), "get", [
          identifier(factory, names.identity),
        ]),
      ),
      absentDeleteBranch(factory, names.entries, "absent property storage"),
      variable(
        factory,
        NodeFlagsConst,
        names.entry,
        undefined,
        call(factory, identifier(factory, names.entries), "get", [
          identifier(factory, names.storageKey),
        ]),
      ),
      absentDeleteBranch(factory, names.entry, "missing property key"),
      variable(
        factory,
        NodeFlagsConst,
        names.deleted,
        undefined,
        call(factory, identifier(factory, names.entries), "delete", [
          identifier(factory, names.storageKey),
        ]),
      ),
      orderedDeleteBranch(factory),
      emptyPropertyStorageCleanup(factory),
      required(
        NewReturnStatement(factory, identifier(factory, names.deleted)),
        "canonical pointer-map property delete return",
      ),
    ],
  );
}

export function clearMethod(factory: NodeFactory): Node {
  return method(factory, "clear", [], voidType(factory), [
    clearStorage(factory, names.roots),
    clearStorage(factory, names.properties),
    clearStorage(factory, names.ordered),
  ]);
}

export function keysMethod(factory: NodeFactory): Node {
  return method(
    factory,
    "keys",
    [],
    required(
      NewArrayTypeNode(factory, typeReference(factory, names.keyType)),
      "canonical pointer-map keys type",
    ),
    [
      variable(
        factory,
        NodeFlagsConst,
        names.result,
        required(
          NewArrayTypeNode(factory, typeReference(factory, names.keyType)),
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
        NewReturnStatement(factory, identifier(factory, names.result)),
        "canonical pointer-map keys return",
      ),
    ],
  );
}

function rootGetBranch(factory: NodeFactory): Node {
  return required(
    NewIfStatement(
      factory,
      isUndefined(factory, identifier(factory, names.storageKey)),
      block(factory, [
        required(
          NewReturnStatement(
            factory,
            call(factory, thisProperty(factory, names.roots), "get", [
              identifier(factory, names.identity),
            ]),
          ),
          "canonical pointer-map root get return",
        ),
      ]),
      undefined,
    ),
    "canonical pointer-map root get branch",
  );
}

function rootInsertBranch(factory: NodeFactory): Node {
  return required(
    NewIfStatement(
      factory,
      isUndefined(factory, identifier(factory, names.storageKey)),
      block(factory, [
        expressionStatement(
          factory,
          call(factory, thisProperty(factory, names.roots), "set", [
            identifier(factory, names.identity),
            identifier(factory, names.entry),
          ]),
        ),
        orderedInsert(factory),
        required(
          NewReturnStatement(factory, undefined),
          "canonical pointer-map root insert return",
        ),
      ]),
      undefined,
    ),
    "canonical pointer-map root insert branch",
  );
}

function rootDeleteBranch(factory: NodeFactory): Node {
  return required(
    NewIfStatement(
      factory,
      isUndefined(factory, identifier(factory, names.storageKey)),
      block(factory, [
        variable(
          factory,
          NodeFlagsConst,
          names.entry,
          undefined,
          call(factory, thisProperty(factory, names.roots), "get", [
            identifier(factory, names.identity),
          ]),
        ),
        absentDeleteBranch(factory, names.entry, "missing root key"),
        variable(
          factory,
          NodeFlagsConst,
          names.deleted,
          undefined,
          call(factory, thisProperty(factory, names.roots), "delete", [
            identifier(factory, names.identity),
          ]),
        ),
        orderedDeleteBranch(factory),
        required(
          NewReturnStatement(factory, identifier(factory, names.deleted)),
          "canonical pointer-map root delete return",
        ),
      ]),
      undefined,
    ),
    "canonical pointer-map root delete branch",
  );
}

function propertyEntriesInitialization(factory: NodeFactory): Node {
  return required(
    NewIfStatement(
      factory,
      isUndefined(factory, identifier(factory, names.entries)),
      block(factory, [
        expressionStatement(
          factory,
          assignment(
            factory,
            identifier(factory, names.entries),
            required(
              NewNewExpression(
                factory,
                identifier(factory, "Map"),
                NodeFactory_NewNodeList(factory, [
                  ...propertyEntriesTypeArguments(factory),
                ]),
                NodeFactory_NewNodeList(factory, []),
              ),
              "canonical pointer-map property inner storage",
            ),
          ),
        ),
        expressionStatement(
          factory,
          call(factory, thisProperty(factory, names.properties), "set", [
            identifier(factory, names.identity),
            identifier(factory, names.entries),
          ]),
        ),
      ]),
      undefined,
    ),
    "canonical pointer-map property storage initialization",
  );
}

function orderedInsert(factory: NodeFactory): Node {
  return expressionStatement(
    factory,
    call(factory, thisProperty(factory, names.ordered), "set", [
      identifier(factory, names.entry),
      undefinedExpression(factory),
    ]),
  );
}

function absentDeleteBranch(
  factory: NodeFactory,
  localName: string,
  label: string,
): Node {
  return required(
    NewIfStatement(
      factory,
      isUndefined(factory, identifier(factory, localName)),
      block(factory, [
        required(
          NewReturnStatement(factory, falseExpression(factory)),
          `canonical pointer-map ${label} delete`,
        ),
      ]),
      undefined,
    ),
    `canonical pointer-map ${label} delete branch`,
  );
}

function orderedDeleteBranch(factory: NodeFactory): Node {
  return required(
    NewIfStatement(
      factory,
      identifier(factory, names.deleted),
      block(factory, [
        expressionStatement(
          factory,
          call(factory, thisProperty(factory, names.ordered), "delete", [
            identifier(factory, names.entry),
          ]),
        ),
      ]),
      undefined,
    ),
    "canonical pointer-map ordered delete",
  );
}

function emptyPropertyStorageCleanup(factory: NodeFactory): Node {
  return required(
    NewIfStatement(
      factory,
      equals(
        factory,
        property(factory, identifier(factory, names.entries), "size"),
        numeric(factory, "0"),
      ),
      block(factory, [
        expressionStatement(
          factory,
          call(factory, thisProperty(factory, names.properties), "delete", [
            identifier(factory, names.identity),
          ]),
        ),
      ]),
      undefined,
    ),
    "canonical pointer-map empty property storage cleanup",
  );
}

function clearStorage(factory: NodeFactory, storageName: string): Node {
  return expressionStatement(
    factory,
    call(factory, thisProperty(factory, storageName), "clear", []),
  );
}

function keysLoop(factory: NodeFactory): Node {
  const declaration = required(
    NewVariableDeclaration(
      factory,
      identifier(factory, names.entry),
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
      call(factory, thisProperty(factory, names.ordered), "keys", []),
      block(factory, [
        expressionStatement(
          factory,
          call(factory, identifier(factory, names.result), "push", [
            property(factory, identifier(factory, names.entry), names.key),
          ]),
        ),
      ]),
    ),
    "canonical pointer-map keys loop",
  );
}
