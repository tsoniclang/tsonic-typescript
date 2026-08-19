import type { Node } from "@tsonic/tsts";

export interface OpaqueInterfaceInputLedger {
  mark(declaration: Node): void;
  has(declaration: Node): boolean;
}

export function createOpaqueInterfaceInputLedger(): OpaqueInterfaceInputLedger {
  const declarations = new Set<Node>();
  return Object.freeze({
    mark(declaration: Node): void {
      declarations.add(declaration);
    },
    has(declaration: Node): boolean {
      return declarations.has(declaration);
    },
  });
}
