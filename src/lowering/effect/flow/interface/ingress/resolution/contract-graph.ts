import type { Node } from "@tsonic/tsts";

import type { EffectProvenanceEdgeKind } from "../../../../provenance/model.js";
import type { InterfaceOriginBoundaryReason } from "../resolution.js";

export interface InterfaceOriginVertex {
  readonly index: number;
}

export interface InterfaceOriginContractGraphMeasurements {
  readonly boundaries: number;
  readonly contracts: number;
  readonly edges: number;
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
  activate(vertex: InterfaceOriginVertex, contract: number): boolean;
  addDependency(
    destination: InterfaceOriginVertex,
    source: InterfaceOriginVertex,
    kind: EffectProvenanceEdgeKind,
    occurrence: Node,
    contract: number,
  ): void;
  addOrigin(vertex: InterfaceOriginVertex, contract: number): void;
  addBoundary(
    vertex: InterfaceOriginVertex,
    reason: InterfaceOriginBoundaryReason,
    contract: number,
  ): void;
  seal(): InterfaceOriginContractGraphResolution;
}

type ContractMasks = Array<Uint32Array | undefined>;

const originFlag = 1;
const boundaryFlag = 2;
const opaqueFlag = 4;

export function createInterfaceOriginContractGraph(
  contracts: readonly Node[],
): InterfaceOriginContractGraphBuilder {
  const wordCount = Math.ceil(contracts.length / 32);
  const vertices: InterfaceOriginVertex[] = [];
  const active: ContractMasks = [];
  const origins: ContractMasks = [];
  const boundaries: ContractMasks = [];
  const opaqueBoundaries: ContractMasks = [];
  const dependents = new Map<number, Map<number, Uint32Array>>();
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
  const assertContract = (contract: number): void => {
    if (!Number.isInteger(contract) || contract < 0 || contract >= contracts.length) {
      throw new Error("interface origin contract index is outside its domain");
    }
  };
  const mark = (masks: ContractMasks, vertex: number, contract: number): boolean => {
    let mask = masks[vertex];
    if (mask === undefined) {
      mask = new Uint32Array(wordCount);
      masks[vertex] = mask;
    }
    const word = contract >>> 5;
    const bit = 1 << (contract & 31);
    const previous = mask[word] ?? 0;
    if ((previous & bit) !== 0) {
      return false;
    }
    mask[word] = previous | bit;
    return true;
  };

  return Object.freeze({
    vertex(): InterfaceOriginVertex {
      assertMutable();
      const vertex = Object.freeze({ index: vertices.length });
      vertices.push(vertex);
      return vertex;
    },
    activate(vertex: InterfaceOriginVertex, contract: number): boolean {
      assertMutable();
      assertVertex(vertex);
      assertContract(contract);
      const added = mark(active, vertex.index, contract);
      if (added) {
        stepCount += 1;
      }
      return added;
    },
    addDependency(
      destination: InterfaceOriginVertex,
      source: InterfaceOriginVertex,
      _kind: EffectProvenanceEdgeKind,
      _occurrence: Node,
      contract: number,
    ): void {
      assertMutable();
      assertVertex(destination);
      assertVertex(source);
      assertContract(contract);
      let destinations = dependents.get(source.index);
      if (destinations === undefined) {
        destinations = new Map();
        dependents.set(source.index, destinations);
      }
      let mask = destinations.get(destination.index);
      if (mask === undefined) {
        mask = new Uint32Array(wordCount);
        destinations.set(destination.index, mask);
        edgeCount += 1;
      }
      setBit(mask, contract);
    },
    addOrigin(vertex: InterfaceOriginVertex, contract: number): void {
      assertMutable();
      assertVertex(vertex);
      assertContract(contract);
      if (mark(origins, vertex.index, contract)) {
        originCount += 1;
      }
    },
    addBoundary(
      vertex: InterfaceOriginVertex,
      reason: InterfaceOriginBoundaryReason,
      contract: number,
    ): void {
      assertMutable();
      assertVertex(vertex);
      assertContract(contract);
      if (mark(boundaries, vertex.index, contract)) {
        boundaryCount += 1;
      }
      if (reason === "opaque-call-transport") {
        mark(opaqueBoundaries, vertex.index, contract);
      }
    },
    seal(): InterfaceOriginContractGraphResolution {
      assertMutable();
      sealed = true;
      const resolved = resolveContractEvidence(
        vertices.length,
        wordCount,
        dependents,
        origins,
        boundaries,
        opaqueBoundaries,
      );
      const measurements = Object.freeze({
        boundaries: boundaryCount,
        contracts: contracts.length,
        edges: edgeCount,
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
          assertContract(contract);
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
  wordCount: number,
  dependents: ReadonlyMap<number, ReadonlyMap<number, Uint32Array>>,
  origins: ContractMasks,
  boundaries: ContractMasks,
  opaqueBoundaries: ContractMasks,
): { flagsFor(vertex: number, contract: number): number } {
  const reachableOrigins = cloneMasks(origins, vertexCount);
  const reachableBoundaries = cloneMasks(boundaries, vertexCount);
  const reachableOpaqueBoundaries = cloneMasks(opaqueBoundaries, vertexCount);
  const sentOrigins: ContractMasks = [];
  const sentBoundaries: ContractMasks = [];
  const sentOpaqueBoundaries: ContractMasks = [];
  const pending: number[] = [];
  const queued = new Uint8Array(vertexCount);
  for (let vertex = 0; vertex < vertexCount; vertex += 1) {
    if (
      reachableOrigins[vertex] !== undefined ||
      reachableBoundaries[vertex] !== undefined
    ) {
      pending.push(vertex);
      queued[vertex] = 1;
    }
  }
  for (let next = 0; next < pending.length; next += 1) {
    const source = pending[next];
    if (source === undefined) {
      throw new Error("interface origin propagation lost a pending vertex");
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
          wordCount,
        ) |
        propagateUnsent(
          reachableBoundaries,
          sentBoundaries,
          source,
          destination,
          contracts,
          wordCount,
        ) |
        propagateUnsent(
          reachableOpaqueBoundaries,
          sentOpaqueBoundaries,
          source,
          destination,
          contracts,
          wordCount,
        );
      if (changed !== 0 && queued[destination] === 0) {
        queued[destination] = 1;
        pending.push(destination);
      }
    }
    copyMask(sentOrigins, reachableOrigins, source, wordCount);
    copyMask(sentBoundaries, reachableBoundaries, source, wordCount);
    copyMask(
      sentOpaqueBoundaries,
      reachableOpaqueBoundaries,
      source,
      wordCount,
    );
  }
  return Object.freeze({
    flagsFor(vertex: number, contract: number): number {
      let flags = 0;
      if (hasBit(reachableOrigins[vertex], contract)) {
        flags |= originFlag;
      }
      if (hasBit(reachableBoundaries[vertex], contract)) {
        flags |= boundaryFlag;
      }
      if (hasBit(reachableOpaqueBoundaries[vertex], contract)) {
        flags |= opaqueFlag;
      }
      return flags;
    },
  });
}

function propagateUnsent(
  reachable: ContractMasks,
  sent: ContractMasks,
  source: number,
  destination: number,
  contracts: Uint32Array,
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
      destinationMask = new Uint32Array(wordCount);
      reachable[destination] = destinationMask;
    }
    const previous = destinationMask[word] ?? 0;
    const next = previous | additions;
    destinationMask[word] = next;
    changed |= previous ^ next;
  }
  return changed;
}

function cloneMasks(source: ContractMasks, length: number): ContractMasks {
  const result: ContractMasks = new Array(length);
  for (let index = 0; index < length; index += 1) {
    const mask = source[index];
    if (mask !== undefined) {
      result[index] = mask.slice();
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
    destinationMask = new Uint32Array(wordCount);
    destination[vertex] = destinationMask;
  }
  destinationMask.set(sourceMask);
}

function setBit(mask: Uint32Array, contract: number): void {
  const word = contract >>> 5;
  mask[word] = (mask[word] ?? 0) | (1 << (contract & 31));
}

function hasBit(mask: Uint32Array | undefined, contract: number): boolean {
  return mask !== undefined &&
    ((mask[contract >>> 5] ?? 0) & (1 << (contract & 31))) !== 0;
}
