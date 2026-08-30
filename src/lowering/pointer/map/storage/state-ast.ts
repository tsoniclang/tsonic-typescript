import type { Node } from "@tsonic/tsts";
import {
  NewNewExpression,
  NewPropertyDeclaration,
  NodeFactory_NewNodeList,
} from "@tsonic/tsts/target-ast";
import type { NodeFactory } from "@tsonic/tsts/target-ast";

import { identifier, required, typeReference } from "../storage-builders.js";
import {
  canonicalPointerMapNames,
  orderedTypeArguments,
  propertyStorageTypeArguments,
  rootStorageTypeArguments,
} from "./model-ast.js";

export function rootStorageProperty(factory: NodeFactory): Node {
  return mapProperty(
    factory,
    canonicalPointerMapNames.roots,
    rootStorageTypeArguments(factory),
    "canonical pointer-map root storage",
  );
}

export function propertyStorageProperty(factory: NodeFactory): Node {
  return mapProperty(
    factory,
    canonicalPointerMapNames.properties,
    propertyStorageTypeArguments(factory),
    "canonical pointer-map property storage",
  );
}

export function orderedStorageProperty(factory: NodeFactory): Node {
  return mapProperty(
    factory,
    canonicalPointerMapNames.ordered,
    orderedTypeArguments(factory),
    "canonical pointer-map ordered storage",
  );
}

function mapProperty(
  factory: NodeFactory,
  name: string,
  typeArguments: readonly Node[],
  label: string,
): Node {
  return required(
    NewPropertyDeclaration(
      factory,
      undefined,
      identifier(factory, name),
      undefined,
      typeReference(factory, "Map", typeArguments),
      required(
        NewNewExpression(
          factory,
          identifier(factory, "Map"),
          NodeFactory_NewNodeList(factory, [...typeArguments]),
          NodeFactory_NewNodeList(factory, []),
        ),
        `${label} initializer`,
      ),
    ),
    label,
  );
}
