import type { Node } from "@tsonic/tsts";
import {
  NewIdentifier,
  NewNewExpression,
  NodeFactory_NewNodeList,
} from "@tsonic/tsts/target-ast";
import type { NodeFactory } from "@tsonic/tsts/target-ast";

import {
  required,
  typeReference,
  unionType,
} from "./storage-builders.js";

export function directObjectPointerMapStorageType(
  factory: NodeFactory,
  keyType: Node,
  bucketType: Node,
  undefinedType: Node,
): Node {
  return unionType(factory, [
    typeReference(factory, "Map", [keyType, bucketType]),
    undefinedType,
  ]);
}

export function directObjectPointerMapStorageConstruction(
  factory: NodeFactory,
  keyType: Node,
  bucketType: Node,
): Node {
  return required(
    NewNewExpression(
      factory,
      required(
        NewIdentifier(factory, "Map"),
        "direct-object pointer-map storage identifier",
      ),
      NodeFactory_NewNodeList(factory, [keyType, bucketType]),
      NodeFactory_NewNodeList(factory, []),
    ),
    "direct-object pointer-map storage construction",
  );
}
