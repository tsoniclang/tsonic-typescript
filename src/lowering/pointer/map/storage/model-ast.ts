import type { Node } from "@tsonic/tsts";
import {
  KindFalseKeyword,
  NewKeywordExpression,
  NewTypeLiteralNode,
  NodeFactory_NewNodeList,
  NodeFlagsConst,
} from "@tsonic/tsts/target-ast";
import type { NodeFactory } from "@tsonic/tsts/target-ast";

import {
  conditional,
  identifier,
  isUndefined,
  objectType,
  property,
  propertySignature,
  required,
  typeReference,
  undefinedExpression,
  undefinedType,
  unionType,
  variable,
} from "../storage-builders.js";

export const canonicalPointerMapNames = Object.freeze({
  keyType: "K",
  valueType: "V",
  roots: "roots",
  properties: "properties",
  ordered: "ordered",
  key: "key",
  value: "value",
  identity: "identity",
  storageKey: "storageKey",
  entries: "entries",
  entry: "entry",
  deleted: "deleted",
  result: "result",
});

export function pointerKeyConstraint(factory: NodeFactory): Node {
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

export function rootStorageTypeArguments(factory: NodeFactory): readonly Node[] {
  return [identityType(factory), entryType(factory)];
}

export function propertyStorageTypeArguments(
  factory: NodeFactory,
): readonly Node[] {
  return [
    identityType(factory),
    typeReference(factory, "Map", propertyEntriesTypeArguments(factory)),
  ];
}

export function propertyEntriesTypeArguments(
  factory: NodeFactory,
): readonly Node[] {
  return [typeReference(factory, "PropertyKey"), entryType(factory)];
}

export function orderedTypeArguments(factory: NodeFactory): readonly Node[] {
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
        propertySignature(factory, canonicalPointerMapNames.key, keyType),
        propertySignature(factory, canonicalPointerMapNames.value, valueType),
      ]),
    ),
    "canonical pointer-map entry type",
  );
}

export function entryType(factory: NodeFactory): Node {
  return canonicalPointerMapEntryType(
    factory,
    typeReference(factory, canonicalPointerMapNames.keyType),
    typeReference(factory, canonicalPointerMapNames.valueType),
  );
}

export function keyPartDeclaration(
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
      isUndefined(factory, identifier(factory, canonicalPointerMapNames.key)),
      undefinedExpression(factory),
      property(factory, identifier(factory, canonicalPointerMapNames.key), propertyName),
    ),
  );
}

export function falseExpression(factory: NodeFactory): Node {
  return required(
    NewKeywordExpression(factory, KindFalseKeyword),
    "canonical pointer-map false expression",
  );
}

function identityType(factory: NodeFactory): Node {
  return unionType(factory, [objectType(factory), undefinedType(factory)]);
}
