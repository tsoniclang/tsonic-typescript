import type { Node, SourceFile } from "@tsonic/tsts";

import type { DirectObjectReplacement } from "./direct-object-replacement.js";
import type { PointerFlowRepresentation } from "./flow-representation.js";

export interface SelectedDirectObjectReplacements {
  readonly byNode: ReadonlyMap<Node, DirectObjectReplacement>;
  readonly byFile: ReadonlyMap<SourceFile, readonly DirectObjectReplacement[]>;
  readonly count: number;
}

export function selectDirectObjectReplacements(
  candidates: readonly DirectObjectReplacement[],
  representations: ReadonlyMap<Node, PointerFlowRepresentation>,
): SelectedDirectObjectReplacements {
  const byNode = new Map<Node, DirectObjectReplacement>();
  const mutableByFile = new Map<SourceFile, DirectObjectReplacement[]>();
  let count = 0;
  for (const candidate of candidates) {
    const storeCalls = candidate.storeCalls.filter((storeCall) =>
      representations.get(storeCall) === "direct-object"
    );
    if (storeCalls.length === 0) {
      continue;
    }
    const replacement: DirectObjectReplacement = Object.freeze({
      ...candidate,
      storeCalls: Object.freeze(storeCalls),
    });
    if (byNode.has(replacement.classDeclaration)) {
      throw new Error("direct-object class selected multiple replacement plans");
    }
    byNode.set(replacement.classDeclaration, replacement);
    for (const storeCall of replacement.storeCalls) {
      if (byNode.has(storeCall)) {
        throw new Error("direct-object store selected multiple replacement plans");
      }
      byNode.set(storeCall, replacement);
    }
    const selected = mutableByFile.get(replacement.sourceFile);
    if (selected === undefined) {
      mutableByFile.set(replacement.sourceFile, [replacement]);
    } else {
      selected.push(replacement);
    }
    count += 1;
  }
  const byFile = new Map<SourceFile, readonly DirectObjectReplacement[]>();
  for (const [sourceFile, replacements] of mutableByFile) {
    byFile.set(sourceFile, Object.freeze([...replacements]));
  }
  return Object.freeze({ byNode, byFile, count });
}
