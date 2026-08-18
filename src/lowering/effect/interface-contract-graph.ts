import type { Node } from "@tsonic/tsts";
import type { TargetSourceProgram } from "@tsonic/target-api";
import {
  KindClassDeclaration,
  KindClassExpression,
  KindCallExpression,
  KindMethodSignature,
} from "@tsonic/tsts/target-ast";

import type { TargetProgramIndex } from "../program-index.js";
import type { StorageOwnerTransportContract } from "../storage-owner-transport.js";
import {
  callableReturnRewrite,
  type CallableReturnRewrite,
} from "./callable-contract.js";
import { declaredInterfaceMemberImplementation } from "./interface-contract-member.js";
import { isExactInterfaceProjectDeclaration } from "./interface-contract-declarations.js";
import { collectInterfaceContractTransports } from "./interface-contract-transport.js";
import {
  createInterfaceContractBoundaryLedger,
  type InterfaceContractBoundaryCause,
  type InterfaceContractBoundaryLedger,
} from "./interface-contract-boundary.js";

export interface InterfaceContractEntry {
  readonly declaration: Node;
  readonly calls: readonly Node[];
  readonly returnRewrite: CallableReturnRewrite;
}

export interface InterfaceContractComponent {
  readonly entries: readonly InterfaceContractEntry[];
  readonly boundary: boolean;
  readonly boundaryCauses: readonly InterfaceContractBoundaryCause[];
}

export interface InterfaceContractGraph {
  readonly consideredCount: number;
  readonly components: readonly InterfaceContractComponent[];
}

export interface MutableInterfaceContractEntry {
  readonly declaration: Node;
  readonly calls: Node[];
  readonly returnRewrite: CallableReturnRewrite;
}

export interface InterfaceContractIndex {
  readonly entries: ReadonlyMap<Node, MutableInterfaceContractEntry>;
  readonly declarationContracts: ReadonlyMap<Node, readonly Node[]>;
  readonly links: Map<Node, Set<Node>>;
  readonly boundaries: InterfaceContractBoundaryLedger;
}

export function createInterfaceContractGraph(
  source: TargetSourceProgram,
  program: TargetProgramIndex,
  transports?: StorageOwnerTransportContract,
): InterfaceContractGraph {
  const contracts = collectContracts(source, program);
  collectCalls(source, program, contracts.entries);
  collectInterfaceContractTransports(source, program, contracts, transports);
  const seeds = [...contracts.entries.values()].filter((entry) =>
    entry.calls.length !== 0
  );
  const visited = new Set<Node>();
  const components: InterfaceContractComponent[] = [];
  for (const seed of seeds) {
    if (visited.has(seed.declaration)) {
      continue;
    }
    const declarations = collectComponent(
      seed.declaration,
      contracts.links,
      visited,
    );
    const entries = declarations.map((declaration) => {
      const entry = contracts.entries.get(declaration);
      if (entry === undefined) {
        throw new Error("interface contract graph lost a linked declaration");
      }
      return Object.freeze({
        declaration: entry.declaration,
        calls: Object.freeze([...entry.calls]),
        returnRewrite: entry.returnRewrite,
      });
    });
    const boundaryCauses = contracts.boundaries.causesFor(declarations);
    components.push(Object.freeze({
      entries: Object.freeze(entries),
      boundary: boundaryCauses.length !== 0,
      boundaryCauses,
    }));
  }
  return Object.freeze({
    consideredCount: seeds.length,
    components: Object.freeze(components),
  });
}

function collectContracts(
  source: TargetSourceProgram,
  program: TargetProgramIndex,
): InterfaceContractIndex {
  const entries = new Map<Node, MutableInterfaceContractEntry>();
  const links = new Map<Node, Set<Node>>();
  for (const declaration of program.nodesOfKind(KindMethodSignature)) {
    const owner = source.ast.parent(declaration);
    const typeNode = source.ast.typeNode(declaration);
    if (
      owner === undefined ||
      !source.ast.is.IsInterfaceDeclaration(owner) ||
      !isExactInterfaceProjectDeclaration(source, owner) ||
      !isExactInterfaceProjectDeclaration(source, declaration) ||
      typeNode === undefined
    ) {
      continue;
    }
    const returnRewrite = callableReturnRewrite(source, typeNode);
    if (returnRewrite === undefined) {
      continue;
    }
    entries.set(declaration, {
      declaration,
      calls: [],
      returnRewrite,
    });
    links.set(declaration, new Set());
  }
  const boundaries = createInterfaceContractBoundaryLedger();
  return {
    entries,
    declarationContracts: collectDeclarationContracts(
      source,
      program,
      entries,
      links,
      boundaries,
    ),
    links,
    boundaries,
  };
}

function collectDeclarationContracts(
  source: TargetSourceProgram,
  program: TargetProgramIndex,
  entries: ReadonlyMap<Node, MutableInterfaceContractEntry>,
  links: Map<Node, Set<Node>>,
  boundaries: InterfaceContractBoundaryLedger,
): ReadonlyMap<Node, readonly Node[]> {
  const ownerContracts = new Map<Node, Node[]>();
  for (const contract of entries.keys()) {
    const owner = source.ast.parent(contract);
    if (owner === undefined) {
      continue;
    }
    const selected = ownerContracts.get(owner);
    if (selected === undefined) {
      ownerContracts.set(owner, [contract]);
    } else {
      selected.push(contract);
    }
  }
  const result = new Map<Node, readonly Node[]>(
    [...ownerContracts].map(([owner, contracts]) => [
      owner,
      Object.freeze([...contracts]),
    ]),
  );
  for (const declaration of program.nodesOfKinds([
    KindClassDeclaration,
    KindClassExpression,
  ])) {
    const contracts = declaredClassContracts(
      source,
      declaration,
      ownerContracts,
    );
    if (contracts.length === 0) {
      continue;
    }
    result.set(declaration, contracts);
    const implementations = new Map<Node, Node[]>();
    for (const contract of contracts) {
      const implementation = declaredInterfaceMemberImplementation(
        source,
        declaration,
        contract,
      );
      if (implementation === undefined) {
        boundaries.mark(
          contract,
          "missing-member-implementation",
          declaration,
        );
        continue;
      }
      const selected = implementations.get(implementation);
      if (selected === undefined) {
        implementations.set(implementation, [contract]);
      } else {
        selected.push(contract);
      }
    }
    for (const shared of implementations.values()) {
      const coordinator = shared[0];
      if (coordinator === undefined) {
        continue;
      }
      for (const contract of shared.slice(1)) {
        linkInterfaceContracts(coordinator, contract, links);
      }
    }
  }
  return result;
}

function declaredClassContracts(
  source: TargetSourceProgram,
  declaration: Node,
  ownerContracts: ReadonlyMap<Node, readonly Node[]>,
): readonly Node[] {
  const result = new Set<Node>();
  const pending = [declaration];
  const seen = new Set<Node>();
  while (pending.length !== 0) {
    const current = pending.pop();
    if (current === undefined || seen.has(current)) {
      continue;
    }
    seen.add(current);
    const heritage = source.navigation.declaredHeritage(current);
    if (heritage.kind !== "resolved") {
      continue;
    }
    for (const edge of heritage.edges) {
      for (const contract of ownerContracts.get(edge.target.declaration) ?? []) {
        result.add(contract);
      }
      if (edge.target.project) {
        pending.push(edge.target.declaration);
      }
    }
  }
  return Object.freeze([...result]);
}

export function linkInterfaceContracts(
  left: Node,
  right: Node,
  links: Map<Node, Set<Node>>,
): void {
  if (left === right) {
    return;
  }
  links.get(left)?.add(right);
  links.get(right)?.add(left);
}

function collectCalls(
  source: TargetSourceProgram,
  program: TargetProgramIndex,
  entries: ReadonlyMap<Node, MutableInterfaceContractEntry>,
): void {
  for (const call of program.nodesOfKind(KindCallExpression)) {
    const semantics = source.semantics.forNode(call);
    const declaration = semantics.getSignatureDeclaration(
      semantics.getResolvedSignature(call),
    );
    if (declaration !== undefined) {
      entries.get(declaration)?.calls.push(call);
    }
  }
}

function collectComponent(
  seed: Node,
  links: ReadonlyMap<Node, ReadonlySet<Node>>,
  visited: Set<Node>,
): readonly Node[] {
  const result: Node[] = [];
  const pending = [seed];
  while (pending.length !== 0) {
    const declaration = pending.pop();
    if (declaration === undefined || visited.has(declaration)) {
      continue;
    }
    visited.add(declaration);
    result.push(declaration);
    for (const linked of links.get(declaration) ?? []) {
      pending.push(linked);
    }
  }
  return result;
}
