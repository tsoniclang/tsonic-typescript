import type { Node } from "@tsonic/tsts";
import { NewIdentifier } from "@tsonic/tsts/target-ast";
import type { NodeFactory } from "@tsonic/tsts/target-ast";

import { PointerLoweringError } from "./diagnostic.js";
import type { LocationBinding } from "./plan.js";

export function locationBindingExpression(
  factory: NodeFactory,
  binding: LocationBinding,
): Node {
  const expression = NewIdentifier(factory, binding.locationName.text);
  if (expression === undefined) {
    throw new PointerLoweringError(
      `${binding.kind} location reference was not created`,
    );
  }
  return expression;
}
