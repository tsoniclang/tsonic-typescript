import type { Node } from "@tsonic/tsts";

import { pruneEmptyModuleBindingContainer } from "./prune-empty.js";

export function finalizeModuleBindingRewrite(
  original: Node,
  updated: Node,
  removeBinding: boolean,
): Node | undefined {
  return removeBinding
    ? undefined
    : pruneEmptyModuleBindingContainer(original, updated);
}
