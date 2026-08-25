import type { Node, SourceFile } from "@tsonic/tsts";
import { sourceBindingWriteAtReference } from "@tsonic/target-api/source";
import type {
  SourceBindingWrite,
  TargetSourceProgram,
} from "@tsonic/target-api/source";
import {
  KindElementAccessExpression,
  KindIdentifier,
  KindPropertyAccessExpression,
  type Kind,
} from "@tsonic/tsts/target-ast";
import type {
  TargetProgramIndex,
  TargetProgramIndexSelection,
} from "./program-index/model.js";
export type {
  TargetProgramIndex,
  TargetProgramIndexOperations,
  TargetProgramIndexSelection,
} from "./program-index/model.js";

interface NodeCensus {
  readonly sourceFiles: readonly SourceFile[];
  readonly nodes: readonly Node[];
  readonly byFile: ReadonlyMap<SourceFile, readonly Node[]>;
  readonly identifierNamesByFile: ReadonlyMap<SourceFile, ReadonlySet<string>>;
  readonly byKind: ReadonlyMap<Kind, readonly Node[]>;
  readonly orderByKind: ReadonlyMap<Kind, Uint32Array>;
  readonly childEdges: number;
  readonly identifierEntries: number;
}

interface CollectedNodeCensus extends NodeCensus {
  readonly potentialBindingReferences: readonly Node[];
}

interface BindingWriteIndex {
  readonly atReference: ReadonlyMap<Node, readonly SourceBindingWrite[]>;
  readonly byDeclaration: ReadonlyMap<Node, readonly SourceBindingWrite[]>;
  readonly candidateCount: number;
  readonly writeCount: number;
}

const noNodes = Object.freeze([]) as readonly Node[];
const noWrites = Object.freeze([]) as readonly SourceBindingWrite[];

export function createTargetProgramIndex(
  source: TargetSourceProgram,
  selection: TargetProgramIndexSelection,
): TargetProgramIndex {
  const { potentialBindingReferences, ...census } =
    collectNodeCensus(source, selection);
  const writes = selection.bindingWrites
    ? collectBindingWrites(source, potentialBindingReferences)
    : emptyBindingWriteIndex();
  const operations = Object.freeze({
    nodeVisits: census.nodes.length,
    childEdges: census.childEdges,
    kindEntries: census.nodes.length,
    identifierEntries: census.identifierEntries,
    sourceReferenceIndex: source.navigation.referenceIndexStatistics,
    bindingCandidates: writes.candidateCount,
    bindingWrites: writes.writeCount,
  });
  const combinedKinds = new Map<string, readonly Node[]>();
  return Object.freeze({
    sourceFiles: census.sourceFiles,
    nodes: census.nodes,
    operations,
    nodesFor(sourceFile: SourceFile): readonly Node[] {
      return census.byFile.get(sourceFile) ?? noNodes;
    },
    hasAuthoredIdentifierName(sourceFile: SourceFile, name: string): boolean {
      return census.identifierNamesByFile.get(sourceFile)?.has(name) === true;
    },
    authoredIdentifierNameCount(sourceFile: SourceFile): number {
      return census.identifierNamesByFile.get(sourceFile)?.size ?? 0;
    },
    nodesOfKind(kind: Kind): readonly Node[] {
      return census.byKind.get(kind) ?? noNodes;
    },
    nodesOfKinds(kinds: readonly Kind[]): readonly Node[] {
      const unique = [...new Set(kinds)].sort((left, right) => left - right);
      if (unique.length === 0) {
        return noNodes;
      }
      if (unique.length === 1) {
        return census.byKind.get(unique[0] ?? -1) ?? noNodes;
      }
      const key = unique.join(",");
      const cached = combinedKinds.get(key);
      if (cached !== undefined) {
        return cached;
      }
      const selected = mergeKindBuckets(census, unique);
      combinedKinds.set(key, selected);
      return selected;
    },
    hasBindingWrite(declaration: Node | undefined): boolean {
      return declaration !== undefined && writes.byDeclaration.has(declaration);
    },
    bindingWritesAt(node: Node | undefined): readonly SourceBindingWrite[] {
      return node === undefined ? noWrites : writes.atReference.get(node) ?? noWrites;
    },
    bindingWritesFor(declaration: Node | undefined): readonly SourceBindingWrite[] {
      return declaration === undefined
        ? noWrites
        : writes.byDeclaration.get(declaration) ?? noWrites;
    },
  });
}

function mergeKindBuckets(
  census: NodeCensus,
  kinds: readonly Kind[],
): readonly Node[] {
  const buckets = kinds.map((kind) => census.byKind.get(kind) ?? noNodes);
  const orders = kinds.map((kind) => census.orderByKind.get(kind) ?? new Uint32Array());
  const offsets = kinds.map(() => 0);
  const selected: Node[] = [];
  for (;;) {
    let selectedBucket = -1;
    let selectedOrder = Number.MAX_SAFE_INTEGER;
    for (let index = 0; index < buckets.length; index += 1) {
      const offset = offsets[index] ?? 0;
      const order = orders[index]?.[offset];
      if (order !== undefined && order < selectedOrder) {
        selectedBucket = index;
        selectedOrder = order;
      }
    }
    if (selectedBucket < 0) {
      return Object.freeze(selected);
    }
    const offset = offsets[selectedBucket] ?? 0;
    const node = buckets[selectedBucket]?.[offset];
    if (node === undefined) {
      throw new Error("target program kind index lost an exact node");
    }
    selected.push(node);
    offsets[selectedBucket] = offset + 1;
  }
}
function collectNodeCensus(
  source: TargetSourceProgram,
  selection: TargetProgramIndexSelection,
): CollectedNodeCensus {
  const sourceFiles = Object.freeze([...source.navigation.sourceFiles]);
  const nodes: Node[] = [];
  const seen = new Set<Node>();
  const byKind = new Map<Kind, Node[]>();
  const orderByKind = new Map<Kind, number[]>();
  const byFile = new Map<SourceFile, readonly Node[]>();
  const identifierNamesByFile = new Map<SourceFile, ReadonlySet<string>>();
  const potentialBindingReferences: Node[] = [];
  let identifierEntries = 0;
  let childEdges = 0;
  for (const sourceFile of sourceFiles) {
    const fileNodes: Node[] = [];
    const identifierNames = new Set<string>();
    const pending: Node[] = [sourceFile];
    while (pending.length !== 0) {
      const node = pending.pop();
      if (node === undefined || seen.has(node)) {
        continue;
      }
      seen.add(node);
      const order = nodes.length;
      if (order > 0xffff_ffff) {
        throw new Error("target program node count exceeds the finite index domain");
      }
      nodes.push(node);
      fileNodes.push(node);
      const kind = source.ast.kind(node);
      if (kind === undefined) {
        throw new Error("checked target node has no syntax kind");
      }
      const selected = byKind.get(kind);
      if (selected === undefined) {
        byKind.set(kind, [node]);
        orderByKind.set(kind, [order]);
      } else {
        selected.push(node);
        orderByKind.get(kind)?.push(order);
      }
      if (selection.bindingWrites && (
        kind === KindIdentifier ||
        kind === KindPropertyAccessExpression ||
        kind === KindElementAccessExpression
      )) {
        potentialBindingReferences.push(node);
      }
      if (kind === KindIdentifier) {
        identifierEntries += 1;
        identifierNames.add(source.ast.text(node));
      }
      const children = source.ast.children(node);
      for (let index = children.length - 1; index >= 0; index -= 1) {
        const child = children[index];
        if (child !== undefined) {
          childEdges += 1;
          pending.push(child);
        }
      }
    }
    byFile.set(sourceFile, Object.freeze(fileNodes));
    identifierNamesByFile.set(sourceFile, identifierNames);
  }
  const sealedKinds = new Map<Kind, readonly Node[]>();
  const sealedOrders = new Map<Kind, Uint32Array>();
  for (const [kind, selected] of byKind) {
    sealedKinds.set(kind, Object.freeze(selected));
    sealedOrders.set(kind, Uint32Array.from(orderByKind.get(kind) ?? []));
  }
  return Object.freeze({
    sourceFiles,
    nodes: Object.freeze(nodes),
    byFile,
    identifierNamesByFile,
    byKind: sealedKinds,
    orderByKind: sealedOrders,
    potentialBindingReferences: Object.freeze(potentialBindingReferences),
    childEdges,
    identifierEntries,
  });
}

function collectBindingWrites(
  source: TargetSourceProgram,
  references: readonly Node[],
): BindingWriteIndex {
  const atReference = new Map<Node, readonly SourceBindingWrite[]>();
  const mutableByDeclaration = new Map<Node, SourceBindingWrite[]>();
  let candidateCount = 0;
  let writeCount = 0;
  for (const node of references) {
    if (!mayReachWrite(source, node)) {
      continue;
    }
    candidateCount += 1;
    const reference = source.navigation.sourceReferenceFor(node);
    if (reference?.project !== true) {
      continue;
    }
    const write = sourceBindingWriteAtReference(source.ast, node);
    if (write === undefined) {
      continue;
    }
    const exact = Object.freeze([write]);
    atReference.set(node, exact);
    writeCount += 1;
    const existing = mutableByDeclaration.get(reference.declaration);
    if (existing === undefined) {
      mutableByDeclaration.set(reference.declaration, [write]);
    } else {
      existing.push(write);
    }
  }
  const byDeclaration = new Map<Node, readonly SourceBindingWrite[]>();
  for (const [declaration, selected] of mutableByDeclaration) {
    byDeclaration.set(declaration, Object.freeze(selected));
  }
  return Object.freeze({
    atReference,
    byDeclaration,
    candidateCount,
    writeCount,
  });
}

function mayReachWrite(source: TargetSourceProgram, node: Node): boolean {
  let current = node;
  for (;;) {
    const parent = source.ast.parent(current);
    if (parent === undefined || source.ast.is.IsSourceFile(parent)) {
      return false;
    }
    if (source.ast.is.IsBinaryExpression(parent)) {
      return source.ast.as.AsBinaryExpression(parent)?.Left === current;
    }
    if (source.ast.is.IsPrefixUnaryExpression(parent)) {
      return source.ast.as.AsPrefixUnaryExpression(parent)?.Operand === current;
    }
    if (source.ast.is.IsPostfixUnaryExpression(parent)) {
      return source.ast.as.AsPostfixUnaryExpression(parent)?.Operand === current;
    }
    if (source.ast.is.IsForInStatement(parent) || source.ast.is.IsForOfStatement(parent)) {
      return source.ast.as.AsForInOrOfStatement(parent)?.Initializer === current;
    }
    current = parent;
  }
}

function emptyBindingWriteIndex(): BindingWriteIndex {
  return Object.freeze({
    atReference: new Map(),
    byDeclaration: new Map(),
    candidateCount: 0,
    writeCount: 0,
  });
}
