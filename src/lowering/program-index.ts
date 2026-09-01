import type { Node, SourceFile } from "@tsonic/tsts";
import type {
  SourceBindingWrite,
  SourceDeclarationReference,
  SourceProjectMemberDispatch,
  TargetSourceProgram,
} from "@tsonic/target-api";
import {
  KindClassDeclaration,
  KindElementAccessExpression,
  KindIdentifier,
  KindPrivateIdentifier,
  KindPropertyAccessExpression,
  KindQualifiedName,
  type Kind,
} from "@tsonic/tsts/target-ast";

import {
  createProjectDeclarationReferenceIndex,
  disabledProjectDeclarationReferenceIndex,
} from "./reference-index.js";
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
  readonly referenceCandidates: readonly Node[];
}

interface BindingWriteIndex {
  readonly atReference: ReadonlyMap<Node, readonly SourceBindingWrite[]>;
  readonly byDeclaration: ReadonlyMap<Node, readonly SourceBindingWrite[]>;
  readonly candidateCount: number;
  readonly writeCount: number;
}

interface MemberDispatchIndex {
  readonly byMember: ReadonlyMap<Node, SourceProjectMemberDispatch>;
  readonly heritageEdges: number;
  readonly memberCount: number;
}
const noNodes = Object.freeze([]) as readonly Node[];
const noWrites = Object.freeze([]) as readonly SourceBindingWrite[];

export function createTargetProgramIndex(
  source: TargetSourceProgram,
  selection: TargetProgramIndexSelection,
): TargetProgramIndex {
  const { potentialBindingReferences, referenceCandidates, ...census } =
    collectNodeCensus(source, selection);
  const references = selection.declarationReferences === true
    ? createProjectDeclarationReferenceIndex(source, referenceCandidates)
    : disabledProjectDeclarationReferenceIndex();
  const writes = selection.bindingWrites
    ? collectBindingWrites(source, potentialBindingReferences)
    : emptyBindingWriteIndex();
  const dispatch = selection.memberDispatch
    ? collectMemberDispatch(source, census.byKind.get(KindClassDeclaration) ?? noNodes)
    : emptyMemberDispatchIndex();
  const operations = Object.freeze({
    nodeVisits: census.nodes.length,
    childEdges: census.childEdges,
    kindEntries: census.nodes.length,
    identifierEntries: census.identifierEntries,
    referenceCandidates: references.candidateCount,
    projectReferences: references.referenceCount,
    bindingCandidates: writes.candidateCount,
    bindingWrites: writes.writeCount,
    heritageEdges: dispatch.heritageEdges,
    dispatchMembers: dispatch.memberCount,
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
    declarationReferenceFor(
      node: Node | undefined,
    ): SourceDeclarationReference | undefined {
      return references.declarationReferenceFor(node);
    },
    referencesToDeclaration(declaration: Node | undefined): readonly Node[] {
      return references.referencesToDeclaration(declaration);
    },
    memberDispatch(node: Node | undefined): SourceProjectMemberDispatch | undefined {
      return node === undefined ? undefined : dispatch.byMember.get(node);
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
  const referenceCandidates: Node[] = [];
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
      if (selection.declarationReferences === true && (
        kind === KindIdentifier ||
        kind === KindPrivateIdentifier ||
        kind === KindPropertyAccessExpression ||
        kind === KindQualifiedName
      )) {
        referenceCandidates.push(node);
      }
      if (kind === KindIdentifier) {
        identifierEntries += 1;
        identifierNames.add(source.ast.text(node));
      }
      const children = source.ast.children(node);
      for (let index = children.length - 1; index >= 0; index -= 1) {
        const child = children[index];
        if (child === undefined || seen.has(child)) {
          continue;
        }
        if (selection.excludeSubtreeRoot?.(child) === true) {
          seen.add(child);
          continue;
        }
        childEdges += 1;
        pending.push(child);
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
    referenceCandidates: Object.freeze(referenceCandidates),
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
  const seenWrites = new Set<Node>();
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
    const selected = source.navigation.bindingWritesWithin(reference.symbol, node);
    if (selected.length === 0) {
      continue;
    }
    const exact = Object.freeze([...selected]);
    atReference.set(node, exact);
    for (const write of exact) {
      if (seenWrites.has(write.reference)) {
        continue;
      }
      seenWrites.add(write.reference);
      writeCount += 1;
      const existing = mutableByDeclaration.get(reference.declaration);
      if (existing === undefined) {
        mutableByDeclaration.set(reference.declaration, [write]);
      } else {
        existing.push(write);
      }
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

function collectMemberDispatch(
  source: TargetSourceProgram,
  classes: readonly Node[],
): MemberDispatchIndex {
  const directBase = new Map<Node, Node>();
  const children = new Map<Node, Node[]>();
  const open = new Set<Node>();
  let heritageEdges = 0;
  for (const declaration of classes) {
    const heritage = source.navigation.declaredHeritage(declaration);
    if (heritage.kind === "unresolved") {
      open.add(declaration);
      continue;
    }
    heritageEdges += heritage.edges.length;
    const bases = heritage.edges.filter((edge) =>
      edge.kind === "extends" &&
      edge.target.project &&
      source.ast.is.IsClassDeclaration(edge.target.declaration)
    );
    if (bases.length > 1) {
      open.add(declaration);
      continue;
    }
    const base = bases[0]?.target.declaration;
    if (base === undefined) {
      continue;
    }
    directBase.set(declaration, base);
    const derived = children.get(base);
    if (derived === undefined) {
      children.set(base, [declaration]);
    } else {
      derived.push(declaration);
    }
  }

  const membersByClass = new Map<Node, Map<string, Node[]>>();
  let memberCount = 0;
  for (const declaration of classes) {
    const byName = new Map<string, Node[]>();
    for (const member of source.ast.members(declaration)) {
      const name = dispatchMemberName(source, member);
      if (member === undefined || name === undefined) {
        continue;
      }
      memberCount += 1;
      const selected = byName.get(name);
      if (selected === undefined) {
        byName.set(name, [member]);
      } else {
        selected.push(member);
      }
    }
    membersByClass.set(declaration, byName);
  }

  const classEntry = new Map<Node, number>();
  const classExit = new Map<Node, number>();
  const overridesBase = new Map<Node, boolean>();
  const classesByName = new Map<string, number[]>();
  const visited = new Set<Node>();
  const activeNames = new Map<string, number>();
  let position = 0;
  for (const root of classes) {
    if (directBase.has(root)) {
      continue;
    }
    position = indexClassTree(
      root,
      children,
      membersByClass,
      activeNames,
      visited,
      classEntry,
      classExit,
      overridesBase,
      classesByName,
      position,
    );
  }
  for (const declaration of classes) {
    if (!visited.has(declaration)) {
      open.add(declaration);
    }
  }

  const byMember = new Map<Node, SourceProjectMemberDispatch>();
  for (const declaration of classes) {
    const entry = classEntry.get(declaration);
    const exit = classExit.get(declaration);
    for (const [name, members] of membersByClass.get(declaration) ?? []) {
      const declarations = classesByName.get(name) ?? [];
      const derived = entry === undefined || exit === undefined
        ? true
        : hasNumberBetween(declarations, entry + 1, exit);
      for (const member of members) {
        byMember.set(member, Object.freeze({
          overridesBase: open.has(declaration) || overridesBase.get(member) === true,
          hasDerivedOverride: open.has(declaration) || derived,
        }));
      }
    }
  }
  return Object.freeze({ byMember, heritageEdges, memberCount });
}

function indexClassTree(
  root: Node,
  children: ReadonlyMap<Node, readonly Node[]>,
  membersByClass: ReadonlyMap<Node, ReadonlyMap<string, readonly Node[]>>,
  activeNames: Map<string, number>,
  visited: Set<Node>,
  classEntry: Map<Node, number>,
  classExit: Map<Node, number>,
  overridesBase: Map<Node, boolean>,
  classesByName: Map<string, number[]>,
  initialPosition: number,
): number {
  const pending: Array<{ readonly declaration: Node; readonly exit: boolean }> = [
    { declaration: root, exit: false },
  ];
  let position = initialPosition;
  while (pending.length !== 0) {
    const event = pending.pop();
    if (event === undefined) {
      continue;
    }
    const names = membersByClass.get(event.declaration) ?? new Map();
    if (event.exit) {
      for (const name of names.keys()) {
        const count = activeNames.get(name) ?? 0;
        if (count <= 1) {
          activeNames.delete(name);
        } else {
          activeNames.set(name, count - 1);
        }
      }
      classExit.set(event.declaration, position - 1);
      continue;
    }
    if (visited.has(event.declaration)) {
      continue;
    }
    visited.add(event.declaration);
    classEntry.set(event.declaration, position);
    for (const [name, members] of names) {
      const inherited = (activeNames.get(name) ?? 0) !== 0;
      for (const member of members) {
        overridesBase.set(member, inherited);
      }
      const declarations = classesByName.get(name);
      if (declarations === undefined) {
        classesByName.set(name, [position]);
      } else {
        declarations.push(position);
      }
      activeNames.set(name, (activeNames.get(name) ?? 0) + 1);
    }
    position += 1;
    pending.push({ declaration: event.declaration, exit: true });
    const derived = children.get(event.declaration) ?? [];
    for (let index = derived.length - 1; index >= 0; index -= 1) {
      const declaration = derived[index];
      if (declaration !== undefined) {
        pending.push({ declaration, exit: false });
      }
    }
  }
  return position;
}

function dispatchMemberName(
  source: TargetSourceProgram,
  member: Node | undefined,
): string | undefined {
  if (
    member === undefined ||
    !source.navigation.isProjectDeclaration(member) ||
    !(
      source.ast.is.IsMethodDeclaration(member) ||
      source.ast.is.IsGetAccessorDeclaration(member) ||
      source.ast.is.IsSetAccessorDeclaration(member) ||
      source.ast.is.IsPropertyDeclaration(member)
    ) ||
    source.ast.hasModifierKind(member, "private") ||
    source.ast.hasModifierKind(member, "static")
  ) {
    return undefined;
  }
  const name = source.ast.name(member);
  return name !== undefined &&
      (
        source.ast.is.IsIdentifier(name) ||
        source.ast.is.IsStringLiteral(name) ||
        source.ast.is.IsNumericLiteral(name)
      )
    ? source.ast.text(name)
    : undefined;
}

function hasNumberBetween(
  sorted: readonly number[],
  minimum: number,
  maximum: number,
): boolean {
  let low = 0;
  let high = sorted.length;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if ((sorted[middle] ?? Number.MAX_SAFE_INTEGER) < minimum) {
      low = middle + 1;
    } else {
      high = middle;
    }
  }
  return (sorted[low] ?? Number.MAX_SAFE_INTEGER) <= maximum;
}

function emptyBindingWriteIndex(): BindingWriteIndex {
  return Object.freeze({
    atReference: new Map(),
    byDeclaration: new Map(),
    candidateCount: 0,
    writeCount: 0,
  });
}

function emptyMemberDispatchIndex(): MemberDispatchIndex {
  return Object.freeze({
    byMember: new Map(),
    heritageEdges: 0,
    memberCount: 0,
  });
}
