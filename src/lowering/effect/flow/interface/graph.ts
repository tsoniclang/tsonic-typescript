import type { Node } from "@tsonic/tsts";
import type { TargetSourceProgram } from "@tsonic/target-api/source";
import {
  KindClassDeclaration,
  KindClassExpression,
  KindCallExpression,
  KindMethodDeclaration,
  KindMethodSignature,
} from "@tsonic/tsts/target-ast";

import type { TargetProgramIndex } from "../../../program-index.js";
import type { InvocationTransportContract } from "../../../invocation-transport.js";
import type { SourceIdentityResolver } from "../../../occurrence.js";
import {
  callableReturnRewrite,
  type CallableReturnRewrite,
} from "../../model/callable-contract.js";
import { isExactInterfaceProjectDeclaration } from "./declarations.js";
import {
  createInterfaceContractImplementationLedger,
  type InterfaceContractImplementationLedger,
} from "./implementations.js";
import { collectInterfaceContractTransports } from "./transport.js";
import {
  createInterfaceContractBoundaryLedger,
  type InterfaceContractBoundaryCause,
  type InterfaceContractBoundaryLedger,
} from "./boundary.js";
import { collectInterfaceContractComponent } from "./component.js";
import { createAbstractInvocationTransports } from "./abstract-transport.js";
import {
  createExactInvocationInputIndex,
  type ExactInvocationInputIndex,
} from "../invocation/inputs.js";
import {
  createExactIndirectInvocationAnalysis,
} from "../invocation/indirect.js";
import type { ExactCallImplementations } from "../callable/result-inputs.js";
import {
  createExactAggregateProjectionIndex,
  type ExactAggregateProjectionIndex,
} from "../aggregate/projection.js";
import {
  createExactObjectPropertyProjectionIndex,
  type ExactObjectPropertyProjectionIndex,
} from "../object/projection.js";

export interface InterfaceContractFlowIndexes {
  readonly invocationInputs: ExactInvocationInputIndex;
  readonly exactCallImplementations?: ExactCallImplementations;
  readonly callableReferenceIsClosed?: (reference: Node) => boolean;
  readonly aggregateProjections: ExactAggregateProjectionIndex;
  readonly objectProjections?: ExactObjectPropertyProjectionIndex;
}

export interface InterfaceContractEntry {
  readonly declaration: Node;
  readonly calls: readonly Node[];
  readonly implementations: readonly Node[];
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
  readonly boundaryCauses: readonly InterfaceContractBoundaryCause[];
  readonly invocationInputs: ExactInvocationInputIndex;
  readonly invocationTransports?: InvocationTransportContract;
}

export interface MutableInterfaceContractEntry {
  readonly declaration: Node;
  readonly calls: Node[];
  readonly returnRewrite?: CallableReturnRewrite;
  readonly abstractTransport: boolean;
}

export interface InterfaceContractIndex {
  readonly entries: ReadonlyMap<Node, MutableInterfaceContractEntry>;
  readonly declarationContracts: ReadonlyMap<Node, readonly Node[]>;
  readonly implementations: InterfaceContractImplementationLedger;
  readonly links: Map<Node, Set<Node>>;
  readonly boundaries: InterfaceContractBoundaryLedger;
}

export function createInterfaceContractGraph(
  source: TargetSourceProgram,
  program: TargetProgramIndex,
  transports?: InvocationTransportContract,
  sourceIdentityFor: SourceIdentityResolver = (sourceFile) =>
    source.documents.forFile(sourceFile).identity,
  indexes?: InterfaceContractFlowIndexes,
): InterfaceContractGraph {
  const aggregateProjections = indexes?.aggregateProjections ??
    createExactAggregateProjectionIndex(source, program);
  const objectProjections = indexes?.objectProjections ??
    createExactObjectPropertyProjectionIndex(source, program);
  const indirectInvocations =
    indexes === undefined
      ? createExactIndirectInvocationAnalysis(
      source,
      program,
      createExactInvocationInputIndex(source, program, aggregateProjections),
      aggregateProjections,
      objectProjections,
      transports,
      ).finalize()
      : undefined;
  const invocationInputs = indexes?.invocationInputs ??
    indirectInvocations?.invocationInputs;
  if (invocationInputs === undefined) {
    throw new Error("interface flow did not create an invocation-input index");
  }
  const exactCallImplementations = indexes?.exactCallImplementations ??
    indirectInvocations?.implementationsFor;
  const contracts = collectContracts(source, program, sourceIdentityFor);
  collectCalls(source, program, contracts.entries);
  const completeInvocationInputs = collectInterfaceContractTransports(
    source,
    program,
    contracts,
    invocationInputs,
    aggregateProjections,
    objectProjections,
    transports,
    exactCallImplementations,
    indexes?.callableReferenceIsClosed ??
      indirectInvocations?.allowsCallableReference,
  );
  const seeds = [...contracts.entries.values()].filter((entry) =>
    entry.returnRewrite !== undefined && entry.calls.length !== 0
  );
  const visited = new Set<Node>();
  const components: InterfaceContractComponent[] = [];
  const consideredDeclarations: Node[] = [];
  for (const seed of seeds) {
    if (visited.has(seed.declaration)) {
      continue;
    }
    const declarations = collectInterfaceContractComponent(
      seed.declaration,
      contracts.links,
      visited,
    );
    consideredDeclarations.push(...declarations);
    const entries = declarations.flatMap((declaration) => {
      const entry = contracts.entries.get(declaration);
      if (entry === undefined) {
        throw new Error("interface contract graph lost a linked declaration");
      }
      return entry.returnRewrite === undefined ? [] : [Object.freeze({
        declaration: entry.declaration,
        calls: Object.freeze([...entry.calls]),
        implementations: contracts.implementations.implementationsFor(
          entry.declaration,
        ),
        returnRewrite: entry.returnRewrite,
      })];
    });
    const boundaryCauses = contracts.boundaries.causesFor(declarations);
    components.push(Object.freeze({
      entries: Object.freeze(entries),
      boundary: boundaryCauses.length !== 0,
      boundaryCauses,
    }));
  }
  const invocationTransports = createAbstractInvocationTransports(
    source,
    contracts,
  );
  return Object.freeze({
    consideredCount: seeds.length,
    components: Object.freeze(components),
    boundaryCauses: contracts.boundaries.causesFor(consideredDeclarations),
    invocationInputs: completeInvocationInputs,
    ...(invocationTransports === undefined ? {} : { invocationTransports }),
  });
}

function collectContracts(
  source: TargetSourceProgram,
  program: TargetProgramIndex,
  sourceIdentityFor: SourceIdentityResolver,
): InterfaceContractIndex {
  const entries = new Map<Node, MutableInterfaceContractEntry>();
  const links = new Map<Node, Set<Node>>();
  for (const declaration of program.nodesOfKinds([
    KindMethodSignature,
    KindMethodDeclaration,
  ])) {
    const owner = source.ast.parent(declaration);
    const typeNode = source.ast.typeNode(declaration);
    const abstractTransport = source.ast.is.IsMethodDeclaration(declaration) &&
      owner !== undefined &&
      source.ast.is.IsClassDeclaration(owner) &&
      source.ast.hasModifierKind(owner, "abstract") &&
      source.ast.hasModifierKind(declaration, "abstract") &&
      source.ast.body(declaration) === undefined;
    const effectContract = source.ast.is.IsMethodSignatureDeclaration(
      declaration,
    ) && owner !== undefined && source.ast.is.IsInterfaceDeclaration(owner);
    if (
      owner === undefined ||
      (!effectContract && !abstractTransport) ||
      !isExactInterfaceProjectDeclaration(source, owner) ||
      !isExactInterfaceProjectDeclaration(source, declaration) ||
      typeNode === undefined
    ) {
      continue;
    }
    const returnRewrite = callableReturnRewrite(source, typeNode);
    if (returnRewrite === undefined && !abstractTransport) {
      continue;
    }
    entries.set(declaration, {
      declaration,
      calls: [],
      ...(returnRewrite === undefined ? {} : { returnRewrite }),
      abstractTransport,
    });
    links.set(declaration, new Set());
  }
  const boundaries = createInterfaceContractBoundaryLedger(
    source,
    sourceIdentityFor,
  );
  const implementations = createInterfaceContractImplementationLedger(
    source,
    (left, right) => linkInterfaceContracts(left, right, links),
  );
  return {
    entries,
    declarationContracts: collectDeclarationContracts(
      source,
      program,
      entries,
      boundaries,
      implementations,
    ),
    implementations,
    links,
    boundaries,
  };
}

function collectDeclarationContracts(
  source: TargetSourceProgram,
  program: TargetProgramIndex,
  entries: ReadonlyMap<Node, MutableInterfaceContractEntry>,
  boundaries: InterfaceContractBoundaryLedger,
  implementations: InterfaceContractImplementationLedger,
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
    for (
      const contract of implementations.recordDeclaredClass(
        declaration,
        contracts,
      )
    ) {
      boundaries.mark(
        contract,
        "missing-member-implementation",
        declaration,
      );
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
    const signature = semantics.operations.call(call)?.selectedSignature;
    const declaration = signature === undefined
      ? undefined
      : semantics.declarations.signatureDeclaration(signature);
    if (declaration !== undefined) {
      entries.get(declaration)?.calls.push(call);
    }
  }
}
