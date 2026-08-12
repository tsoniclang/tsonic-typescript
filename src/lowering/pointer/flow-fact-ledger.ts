import {
  pointerFactKey,
  pointerOperationFactKey,
} from "@tsonic/tsts";
import type {
  Node,
  PointerFact,
  PointerOperationFact,
} from "@tsonic/tsts";
import type { TargetSourceProgram } from "@tsonic/target-api";

import type { TargetProgramIndex } from "../program-index.js";
import { validatePointerOperationFact } from "./operation-contract.js";
import type { PointerPlanningLedger } from "./planning-ledger.js";
import { validatePointerFact } from "./type-contract.js";

export interface PointerOperationEntry {
  readonly node: Node;
  readonly fact: PointerOperationFact;
}

export interface PointerTypeEntry {
  readonly node: Node;
  readonly fact: PointerFact;
}

export interface PointerTypedFactLedger {
  readonly operationEntries: readonly PointerOperationEntry[];
  readonly pointerTypeEntries: readonly PointerTypeEntry[];
  operationFor(node: Node | undefined): PointerOperationFact | undefined;
  pointerFactFor(node: Node | undefined): PointerFact | undefined;
}

export function buildPointerTypedFactLedger(
  source: TargetSourceProgram,
  program: TargetProgramIndex,
  planning: PointerPlanningLedger,
): PointerTypedFactLedger {
  const operations = new Map<Node, PointerOperationFact>();
  const pointerTypes = new Map<Node, PointerFact>();
  const operationEntries: PointerOperationEntry[] = [];
  const pointerTypeEntries: PointerTypeEntry[] = [];
  for (const node of planning.candidates(
    "flow-census",
    "typed-fact-node",
    program.nodes,
  )) {
    const operation = source.sourceFacts.getFact(node, pointerOperationFactKey);
    if (operation !== undefined) {
      if (operation.call !== node) {
        throw new Error("pointer operation fact is not attached to its exact call");
      }
      validatePointerOperationFact(source, operation);
      operations.set(node, operation);
      operationEntries.push(Object.freeze({ node, fact: operation }));
    }
    const pointerFact = source.sourceFacts.getFact(node, pointerFactKey);
    if (pointerFact !== undefined) {
      validatePointerFact(source, node, pointerFact);
      pointerTypes.set(node, pointerFact);
      pointerTypeEntries.push(Object.freeze({ node, fact: pointerFact }));
    }
  }
  planning.assertCandidateCount("typed-fact-node", program.nodes.length);
  return Object.freeze({
    operationEntries: Object.freeze(operationEntries),
    pointerTypeEntries: Object.freeze(pointerTypeEntries),
    operationFor(node: Node | undefined): PointerOperationFact | undefined {
      return node === undefined ? undefined : operations.get(node);
    },
    pointerFactFor(node: Node | undefined): PointerFact | undefined {
      return node === undefined ? undefined : pointerTypes.get(node);
    },
  });
}
