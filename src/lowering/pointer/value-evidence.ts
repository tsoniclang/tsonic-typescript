import type { Node, Type } from "@tsonic/tsts";
import type { TargetSourceProgram } from "@tsonic/target-api";

import { typeHasDefinitelyNonThenableContract } from "../thenability.js";
import type { PointerTypeEntry } from "./flow-fact-ledger.js";
import type { PointerFlowRepresentation } from "./flow-representation.js";
import type { PointerPlanningLedger } from "./planning-ledger.js";

export interface ClosedPointerValueEvidence {
  directRepresentationFor(
    node: Node | undefined,
  ): PointerFlowRepresentation | undefined;
  representationFor(
    node: Node | undefined,
  ): PointerFlowRepresentation | undefined;
  isDefinitelyNonThenable(node: Node | undefined): boolean;
}

interface PointerValueContract {
  readonly representation: PointerFlowRepresentation;
  readonly pointee?: Type;
}

const representationContracts: Readonly<
  Record<PointerFlowRepresentation, PointerValueContract>
> = Object.freeze({
  location: Object.freeze({ representation: "location" }),
  "direct-snapshot": Object.freeze({ representation: "direct-snapshot" }),
  "mutable-cell": Object.freeze({ representation: "mutable-cell" }),
  "direct-object": Object.freeze({ representation: "direct-object" }),
});

export function closePointerValueEvidence(
  source: TargetSourceProgram,
  pointerTypes: readonly PointerTypeEntry[],
  representations: ReadonlyMap<Node, PointerFlowRepresentation>,
  ledger: PointerPlanningLedger,
): ClosedPointerValueEvidence {
  const contracts = new Map<Node, PointerValueContract>();
  for (const [node, representation] of representations) {
    ledger.record("representation");
    contracts.set(node, representationContracts[representation]);
  }

  const ambiguousOwners = new Set<Node>();
  for (const entry of pointerTypes) {
    ledger.record("representation");
    const owner = pointerValueOwner(source, entry.node);
    const pointee = source.semantics.forNode(entry.fact.pointee)
      .getTypeFromTypeNode(entry.fact.pointee);
    if (owner === undefined || pointee === undefined) {
      continue;
    }
    const contract = Object.freeze({
      representation: representations.get(entry.node) ?? "location",
      pointee,
    });
    contracts.set(entry.node, contract);
    mergeOwnerContract(contracts, ambiguousOwners, owner, contract);
  }

  return Object.freeze({
    directRepresentationFor(
      node: Node | undefined,
    ): PointerFlowRepresentation | undefined {
      return node === undefined ? undefined : contracts.get(node)?.representation;
    },
    representationFor(
      node: Node | undefined,
    ): PointerFlowRepresentation | undefined {
      return exactContractFor(source, node, contracts)?.representation;
    },
    isDefinitelyNonThenable(node: Node | undefined): boolean {
      const contract = exactContractFor(source, node, contracts);
      if (
        contract?.representation === "location" ||
        contract?.representation === "mutable-cell" ||
        contract?.representation === "direct-snapshot"
      ) {
        return true;
      }
      return contract?.representation === "direct-object" &&
        contract.pointee !== undefined &&
        node !== undefined &&
        typeHasDefinitelyNonThenableContract(
          source,
          source.semantics.forNode(node),
          contract.pointee,
        );
    },
  });
}

function mergeOwnerContract(
  contracts: Map<Node, PointerValueContract>,
  ambiguousOwners: Set<Node>,
  owner: Node,
  contract: PointerValueContract,
): void {
  if (ambiguousOwners.has(owner)) {
    return;
  }
  const current = contracts.get(owner);
  if (current === undefined) {
    contracts.set(owner, contract);
    return;
  }
  if (current.representation === contract.representation) {
    if (current.pointee === undefined) {
      contracts.set(owner, contract);
      return;
    }
    if (current.pointee === contract.pointee) {
      return;
    }
  }
  contracts.delete(owner);
  ambiguousOwners.add(owner);
}

function exactContractFor(
  source: TargetSourceProgram,
  node: Node | undefined,
  contracts: ReadonlyMap<Node, PointerValueContract>,
): PointerValueContract | undefined {
  if (node === undefined) {
    return undefined;
  }
  const direct = contracts.get(node);
  if (direct !== undefined) {
    return direct;
  }
  const owner = selectedPointerValueOwner(source, node);
  return owner === undefined ? undefined : contracts.get(owner);
}

function selectedPointerValueOwner(
  source: TargetSourceProgram,
  node: Node,
): Node | undefined {
  if (source.ast.is.IsPropertyAccessExpression(node)) {
    return source.semantics.forNode(node)
      .getResolvedPropertyAccessInfo(node)?.selectedDeclaration;
  }
  if (source.ast.is.IsElementAccessExpression(node)) {
    return source.semantics.forNode(node)
      .getResolvedElementAccessInfo(node)?.selectedDeclaration;
  }
  return source.ast.is.IsIdentifier(node)
    ? source.navigation.sourceReferenceFor(node)?.declaration
    : undefined;
}

function pointerValueOwner(
  source: TargetSourceProgram,
  pointerType: Node,
): Node | undefined {
  let current = source.ast.parent(pointerType);
  while (current !== undefined) {
    if (source.ast.typeNode(current) !== undefined) {
      return current;
    }
    current = source.ast.parent(current);
  }
  return undefined;
}
