import type { Node } from "@tsonic/tsts";
import {
  NewClassDeclaration,
  NewIdentifier,
  NewNewExpression,
  NodeFactory_NewNodeList,
} from "@tsonic/tsts/target-ast";
import type { NodeFactory } from "@tsonic/tsts/target-ast";

import type { GeneratedBindingName } from "../../generated-names.js";
import {
  identifier,
  required,
  typeReference,
  unionType,
} from "./storage-builders.js";
import { canonicalPointerMapStorageShape } from "./storage-members-ast.js";

export function canonicalPointerMapStorageClass(
  factory: NodeFactory,
  name: GeneratedBindingName,
): Node {
  const shape = canonicalPointerMapStorageShape(factory);
  return required(
    NewClassDeclaration(
      factory,
      undefined,
      identifier(factory, name.text),
      NodeFactory_NewNodeList(factory, [...shape.typeParameters]),
      undefined,
      NodeFactory_NewNodeList(factory, [...shape.members]),
    ),
    "canonical pointer-map storage class",
  );
}

export function canonicalPointerMapStorageType(
  factory: NodeFactory,
  name: GeneratedBindingName,
  keyType: Node,
  valueType: Node,
  undefinedType: Node,
): Node {
  return unionType(factory, [
    typeReference(factory, name.text, [keyType, valueType]),
    undefinedType,
  ]);
}

export function canonicalPointerMapStorageConstruction(
  factory: NodeFactory,
  name: GeneratedBindingName,
  keyType: Node,
  valueType: Node,
): Node {
  return required(
    NewNewExpression(
      factory,
      required(
        NewIdentifier(factory, name.text),
        "canonical pointer-map storage identifier",
      ),
      NodeFactory_NewNodeList(factory, [keyType, valueType]),
      NodeFactory_NewNodeList(factory, []),
    ),
    "canonical pointer-map storage construction",
  );
}
