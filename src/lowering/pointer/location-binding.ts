import type { Node } from "@tsonic/tsts";
import { NewIdentifier } from "@tsonic/tsts/target-ast";
import type { NodeFactory } from "@tsonic/tsts/target-ast";

import { PointerLoweringError } from "./diagnostic.js";
import type { LocationBinding } from "./plan.js";

export function locationBindingExpression(
  factory: NodeFactory,
  binding: LocationBinding,
  _variableExpression: Node,
): Node {
  const name = binding.kind === "variable"
    ? binding.sourceName
    : binding.locationName;
  const expression = NewIdentifier(factory, name);
  if (expression === undefined) {
    throw new PointerLoweringError(
      `${binding.kind} location reference was not created`,
    );
  }
  return expression;
}
