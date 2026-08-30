import type { PointerFlowRepresentation } from "../flow-representation.js";

export type PointerKeyMapStorageKind = "location" | "direct-object";

export function pointerKeyMapStorageKind(
  hash: PointerFlowRepresentation,
  equal: PointerFlowRepresentation,
): PointerKeyMapStorageKind | undefined {
  if (hash !== equal) {
    return undefined;
  }
  return hash === "location" || hash === "direct-object" ? hash : undefined;
}
