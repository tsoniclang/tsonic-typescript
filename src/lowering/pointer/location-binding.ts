import type { Node } from "@tsonic/tsts";
import { NewIdentifier } from "@tsonic/tsts/target-ast";
import type { NodeFactory } from "@tsonic/tsts/target-ast";

import type { GeneratedBindingName } from "../generated-names.js";
import { PointerLoweringError } from "./diagnostic.js";

export interface LocalLocationBinding {
  readonly kind: "variable";
  readonly declaration: Node;
  readonly addressOperands: ReadonlySet<Node>;
  readonly sourceName: string;
  readonly locationName: GeneratedBindingName;
  readonly writeName: GeneratedBindingName;
}

export interface ParameterLocationBinding {
  readonly kind: "parameter";
  readonly declaration: Node;
  readonly addressOperands: ReadonlySet<Node>;
  readonly body: Node;
  readonly sourceName: string;
  readonly locationName: GeneratedBindingName;
  readonly writeName: GeneratedBindingName;
}

export type LocationBinding = LocalLocationBinding | ParameterLocationBinding;

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
