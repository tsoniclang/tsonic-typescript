import type { Node } from "@tsonic/tsts";
import type { NodeFactory } from "@tsonic/tsts/target-ast";

import { typeParameter } from "./storage-builders.js";
import {
  canonicalPointerMapNames,
  pointerKeyConstraint,
} from "./storage/model-ast.js";
import {
  clearMethod,
  deleteMethod,
  getMethod,
  insertMethod,
  keysMethod,
} from "./storage/operations-ast.js";
import {
  orderedStorageProperty,
  propertyStorageProperty,
  rootStorageProperty,
} from "./storage/state-ast.js";

export { canonicalPointerMapEntryType } from "./storage/model-ast.js";

export interface CanonicalPointerMapStorageShape {
  readonly typeParameters: readonly Node[];
  readonly members: readonly Node[];
}

export function canonicalPointerMapStorageShape(
  factory: NodeFactory,
): CanonicalPointerMapStorageShape {
  return Object.freeze({
    typeParameters: Object.freeze([
      typeParameter(
        factory,
        canonicalPointerMapNames.keyType,
        pointerKeyConstraint(factory),
      ),
      typeParameter(factory, canonicalPointerMapNames.valueType),
    ]),
    members: Object.freeze([
      rootStorageProperty(factory),
      propertyStorageProperty(factory),
      orderedStorageProperty(factory),
      getMethod(factory),
      insertMethod(factory),
      deleteMethod(factory),
      clearMethod(factory),
      keysMethod(factory),
    ]),
  });
}
