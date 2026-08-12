import type { Node } from "@tsonic/tsts";
import type { TargetSourceProgram } from "@tsonic/target-api";

import { PointerLoweringError } from "./diagnostic.js";

export function validateAddressableStorage(
  source: TargetSourceProgram,
  storage: Node,
): void {
  let current: Node | undefined = storage;
  while (current !== undefined) {
    if (source.ast.is.IsPropertyAccessExpression(current)) {
      const property = source.ast.as.AsPropertyAccessExpression(current);
      if (property?.name === undefined || property.Expression === undefined) {
        throw new PointerLoweringError(
          "addressed property has no exact base or name",
        );
      }
      if (source.ast.is.IsPrivateIdentifier(property.name)) {
        throw new PointerLoweringError(
          "address-of does not support private field storage",
        );
      }
      current = property.Expression;
      continue;
    }
    if (source.ast.is.IsElementAccessExpression(current)) {
      const element = source.ast.as.AsElementAccessExpression(current);
      if (
        element?.Expression === undefined ||
        element.ArgumentExpression === undefined
      ) {
        throw new PointerLoweringError(
          "addressed element has no exact base or key",
        );
      }
      current = element.Expression;
      continue;
    }
    return;
  }
}
