import type { Node } from "@tsonic/tsts";
import {
  NewNewExpression,
  NewPropertyDeclaration,
  NewTypeLiteralNode,
  NodeFactory_NewNodeList,
} from "@tsonic/tsts/target-ast";
import type { NodeFactory } from "@tsonic/tsts/target-ast";

import {
  identifier,
  objectType,
  propertySignature,
  required,
  typeParameter,
  typeReference,
  undefinedType,
  unionType,
} from "./storage-builders.js";
import { canonicalPointerMapStorageMethods } from "./storage-methods-ast.js";

const keyTypeName = "K";
const valueTypeName = "V";
const valuesName = "entries";
const propertyIdentitiesName = "propertyIdentities";

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
      mapProperty(
        factory,
        valuesName,
        unionType(factory, [objectType(factory), undefinedType(factory)]),
        typeReference(factory, valueTypeName),
      ),
      mapProperty(
        factory,
        propertyIdentitiesName,
        objectType(factory),
        propertyIdentityMapType(factory),
      ),
      ...canonicalPointerMapStorageMethods(factory),
    ]),
  });
}

function mapProperty(
  factory: NodeFactory,
  name: string,
  keyType: Node,
  valueType: Node,
): Node {
  const arguments_ = [keyType, valueType];
  return required(
    NewPropertyDeclaration(
      factory,
      undefined,
      identifier(factory, name),
      undefined,
      typeReference(factory, "Map", arguments_),
      required(
        NewNewExpression(
          factory,
          identifier(factory, "Map"),
          NodeFactory_NewNodeList(factory, arguments_),
          NodeFactory_NewNodeList(factory, []),
        ),
        `canonical pointer-map ${name} initializer`,
      ),
    ),
    `canonical pointer-map ${name}`,
  );
}

function propertyIdentityMapType(factory: NodeFactory): Node {
  return typeReference(factory, "Map", [
    typeReference(factory, "PropertyKey"),
    objectType(factory),
  ]);
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
