import type { Node } from "@tsonic/tsts";

export interface FinalNodeLookup {
  forOriginal(original: Node): Node | undefined;
}

export interface FinalNodeJournal extends FinalNodeLookup {
  record(original: Node, finalNode: Node | undefined): Node | undefined;
}

export function createFinalNodeJournal(): FinalNodeJournal {
  const nodes = new Map<Node, Node>();
  const recorded = new Set<Node>();
  return Object.freeze({
    forOriginal(original: Node): Node | undefined {
      return nodes.get(original);
    },
    record(original: Node, finalNode: Node | undefined): Node | undefined {
      if (recorded.has(original)) {
        throw new Error("lowering transaction node was finalized twice");
      }
      recorded.add(original);
      if (finalNode !== undefined) {
        nodes.set(original, finalNode);
      }
      return finalNode;
    },
  });
}
