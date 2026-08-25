import type { Node } from "@tsonic/tsts";

import type { EffectProvenanceEdgeKind } from "../../../../provenance/model.js";
import type { InterfaceOriginBoundaryReason } from "../resolution.js";
import {
  type InterfaceOriginContractDomain,
  type InterfaceOriginContractSet,
  contractSet,
} from "./contract-set.js";
import { createInterfaceOriginWorkQueue } from "./work-queue.js";

export interface InterfaceOriginVertex {
  readonly index: number;
}

export interface InterfaceOriginContractGraphMeasurements {
  readonly boundaries: number;
  readonly contracts: number;
  readonly edges: number;
  readonly frontier: number;
  readonly origins: number;
  readonly steps: number;
  readonly vertices: number;
}

export interface InterfaceOriginContractGraphResolution {
  readonly measurements: InterfaceOriginContractGraphMeasurements;
  resolutionFor(
    vertex: InterfaceOriginVertex,
    contract: number,
  ): { readonly closed: boolean; readonly opaque: boolean };
}

export interface InterfaceOriginContractGraphBuilder {
  vertex(): InterfaceOriginVertex;
  activate(
    vertex: InterfaceOriginVertex,
    contracts: InterfaceOriginContractSet,
  ): InterfaceOriginContractSet;
  addDependency(
    destination: InterfaceOriginVertex,
    source: InterfaceOriginVertex,
    kind: EffectProvenanceEdgeKind,
    occurrence: Node,
    contracts: InterfaceOriginContractSet,
  ): void;
  addOrigin(
    vertex: InterfaceOriginVertex,
    contracts: InterfaceOriginContractSet,
  ): void;
  addBoundary(
    vertex: InterfaceOriginVertex,
    reason: InterfaceOriginBoundaryReason,
    contracts: InterfaceOriginContractSet,
  ): void;
  seal(): InterfaceOriginContractGraphResolution;
}

type ContractMasks = Array<InterfaceOriginContractSet | undefined>;

const originFlag = 1;
const boundaryFlag = 2;
const opaqueFlag = 4;

export function createInterfaceOriginContractGraph(
  domain: InterfaceOriginContractDomain,
): InterfaceOriginContractGraphBuilder {
  const vertices: InterfaceOriginVertex[] = [];
  const active: ContractMasks = [];
  const origins: ContractMasks = [];
  const boundaries: ContractMasks = [];
  const opaqueBoundaries: ContractMasks = [];
  const dependents = new Map<
    number,
    Map<number, InterfaceOriginContractSet>
  >();
  let edgeCount = 0;
  let originCount = 0;
  let boundaryCount = 0;
  let stepCount = 0;
  let sealed = false;

  const assertMutable = (): void => {
    if (sealed) {
      throw new Error("interface origin contract graph is already sealed");
    }
  };
  const assertVertex = (vertex: InterfaceOriginVertex): void => {
    if (vertices[vertex.index] !== vertex) {
      throw new Error("interface origin vertex belongs to another graph");
    }
  };

  return Object.freeze({
    vertex(): InterfaceOriginVertex {
      assertMutable();
      const vertex = Object.freeze({ index: vertices.length });
      vertices.push(vertex);
      return vertex;
    },
    activate(
      vertex: InterfaceOriginVertex,
      contracts: InterfaceOriginContractSet,
    ): InterfaceOriginContractSet {
      assertMutable();
      assertVertex(vertex);
      const added = addMask(active, vertex.index, contracts, domain);
      stepCount += domain.count(added);
      return added;
    },
    addDependency(
      destination: InterfaceOriginVertex,
      source: InterfaceOriginVertex,
      _kind: EffectProvenanceEdgeKind,
      _occurrence: Node,
      contracts: InterfaceOriginContractSet,
    ): void {
      assertMutable();
      assertVertex(destination);
      assertVertex(source);
      if (domain.isEmpty(contracts)) {
        return;
      }
      let destinations = dependents.get(source.index);
      if (destinations === undefined) {
        destinations = new Map();
        dependents.set(source.index, destinations);
      }
      const existing = destinations.get(destination.index);
      if (existing === undefined) {
        destinations.set(destination.index, contracts);
        edgeCount += 1;
      } else {
        destinations.set(destination.index, domain.union(existing, contracts));
      }
    },
    addOrigin(
      vertex: InterfaceOriginVertex,
      contracts: InterfaceOriginContractSet,
    ): void {
      assertMutable();
      assertVertex(vertex);
      originCount += domain.count(addMask(origins, vertex.index, contracts, domain));
    },
    addBoundary(
      vertex: InterfaceOriginVertex,
      reason: InterfaceOriginBoundaryReason,
      contracts: InterfaceOriginContractSet,
    ): void {
      assertMutable();
      assertVertex(vertex);
      boundaryCount += domain.count(
        addMask(boundaries, vertex.index, contracts, domain),
      );
      if (reason === "opaque-call-transport") {
        addMask(opaqueBoundaries, vertex.index, contracts, domain);
      }
    },
    seal(): InterfaceOriginContractGraphResolution {
      assertMutable();
      sealed = true;
      const resolved = resolveContractEvidence(
        vertices.length,
        domain,
        dependents,
        origins,
        boundaries,
        opaqueBoundaries,
      );
      const measurements = Object.freeze({
        boundaries: boundaryCount,
        contracts: domain.contracts.length,
        edges: edgeCount,
        frontier: resolved.frontier,
        origins: originCount,
        steps: stepCount,
        vertices: vertices.length,
      });
      return Object.freeze({
        measurements,
        resolutionFor(
          vertex: InterfaceOriginVertex,
          contract: number,
        ): { readonly closed: boolean; readonly opaque: boolean } {
          assertVertex(vertex);
          const flags = resolved.flagsFor(vertex.index, contract);
          return Object.freeze({
            closed: (flags & originFlag) !== 0 && (flags & boundaryFlag) === 0,
            opaque: (flags & opaqueFlag) !== 0,
          });
        },
      });
    },
  });
}

function resolveContractEvidence(
  vertexCount: number,
  domain: InterfaceOriginContractDomain,
  dependents: ReadonlyMap<
    number,
    ReadonlyMap<number, InterfaceOriginContractSet>
  >,
  origins: ContractMasks,
  boundaries: ContractMasks,
  opaqueBoundaries: ContractMasks,
): {
  readonly frontier: number;
  flagsFor(vertex: number, contract: number): number;
} {
  const reachableOrigins = cloneMasks(origins, vertexCount);
  const reachableBoundaries = cloneMasks(boundaries, vertexCount);
  const reachableOpaqueBoundaries = cloneMasks(opaqueBoundaries, vertexCount);
  const sentOrigins: ContractMasks = [];
  const sentBoundaries: ContractMasks = [];
  const sentOpaqueBoundaries: ContractMasks = [];
  const pending = createInterfaceOriginWorkQueue<number>();
  const queued = new Uint8Array(vertexCount);
  for (let vertex = 0; vertex < vertexCount; vertex += 1) {
    if (
      reachableOrigins[vertex] !== undefined ||
      reachableBoundaries[vertex] !== undefined
    ) {
      pending.enqueue(vertex);
      queued[vertex] = 1;
    }
  }
  for (;;) {
    const source = pending.dequeue();
    if (source === undefined) {
      break;
    }
    queued[source] = 0;
    for (const [destination, contracts] of dependents.get(source) ?? []) {
      const changed =
        propagateUnsent(
          reachableOrigins,
          sentOrigins,
          source,
          destination,
          contracts,
          domain.wordCount,
        ) |
        propagateUnsent(
          reachableBoundaries,
          sentBoundaries,
          source,
          destination,
          contracts,
          domain.wordCount,
        ) |
        propagateUnsent(
          reachableOpaqueBoundaries,
          sentOpaqueBoundaries,
          source,
          destination,
          contracts,
          domain.wordCount,
        );
      if (changed !== 0 && queued[destination] === 0) {
        queued[destination] = 1;
        pending.enqueue(destination);
      }
    }
    copyMask(sentOrigins, reachableOrigins, source, domain.wordCount);
    copyMask(sentBoundaries, reachableBoundaries, source, domain.wordCount);
    copyMask(
      sentOpaqueBoundaries,
      reachableOpaqueBoundaries,
      source,
      domain.wordCount,
    );
  }
  return Object.freeze({
    frontier: pending.highWaterMark,
    flagsFor(vertex: number, contract: number): number {
      let flags = 0;
      if (domain.has(reachableOrigins[vertex] ?? domain.empty(), contract)) {
        flags |= originFlag;
      }
      if (domain.has(reachableBoundaries[vertex] ?? domain.empty(), contract)) {
        flags |= boundaryFlag;
      }
      if (
        domain.has(reachableOpaqueBoundaries[vertex] ?? domain.empty(), contract)
      ) {
        flags |= opaqueFlag;
      }
      return flags;
    },
  });
}

function addMask(
  masks: ContractMasks,
  vertex: number,
  contracts: InterfaceOriginContractSet,
  domain: InterfaceOriginContractDomain,
): InterfaceOriginContractSet {
  const existing = masks[vertex] ?? domain.empty();
  const added = domain.subtract(contracts, existing);
  if (!domain.isEmpty(added)) {
    masks[vertex] = domain.union(existing, added);
  }
  return added;
}

function propagateUnsent(
  reachable: ContractMasks,
  sent: ContractMasks,
  source: number,
  destination: number,
  contracts: InterfaceOriginContractSet,
  wordCount: number,
): number {
  const sourceMask = reachable[source];
  if (sourceMask === undefined) {
    return 0;
  }
  const sentMask = sent[source];
  let destinationMask = reachable[destination];
  let changed = 0;
  for (let word = 0; word < wordCount; word += 1) {
    const additions = (sourceMask[word] ?? 0) &
      ~(sentMask?.[word] ?? 0) &
      (contracts[word] ?? 0);
    if (additions === 0) {
      continue;
    }
    if (destinationMask === undefined) {
      destinationMask = contractSet(wordCount);
      reachable[destination] = destinationMask;
    }
    const previous = destinationMask[word] ?? 0;
    const selected = previous | additions;
    destinationMask[word] = selected;
    changed |= previous ^ selected;
  }
  return changed;
}

function cloneMasks(source: ContractMasks, length: number): ContractMasks {
  const result: ContractMasks = new Array(length);
  for (let index = 0; index < length; index += 1) {
    const mask = source[index];
    if (mask !== undefined) {
      result[index] = mask.slice() as InterfaceOriginContractSet;
    }
  }
  return result;
}

function copyMask(
  destination: ContractMasks,
  source: ContractMasks,
  vertex: number,
  wordCount: number,
): void {
  const sourceMask = source[vertex];
  if (sourceMask === undefined) {
    return;
  }
  let destinationMask = destination[vertex];
  if (destinationMask === undefined) {
    destinationMask = contractSet(wordCount);
    destination[vertex] = destinationMask;
  }
  destinationMask.set(sourceMask);
}
