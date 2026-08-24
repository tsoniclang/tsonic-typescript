import type { Node } from "@tsonic/tsts";
import type { TargetSourceProgram } from "@tsonic/target-api/source";
import {
  KindClassDeclaration,
  KindClassExpression,
  KindCallExpression,
  KindMethodDeclaration,
} from "@tsonic/tsts/target-ast";

import type { TargetProgramIndex } from "../../../program-index.js";
import {
  composeInvocationTransportContracts,
  type InvocationTransportContract,
} from "../../../invocation-transport.js";
import type { SourceIdentityResolver } from "../../../occurrence.js";
import {
  type CallableReturnRewrite,
} from "../../model/callable-contract.js";
import { isExactInterfaceSourceDeclaration } from "./declarations.js";
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
import {
  createExactInvocationInputIndex,
  type ExactInvocationInputIndex,
} from "../invocation/inputs.js";
import {
  createExactIndirectInvocationAnalysis,
} from "../invocation/indirect.js";
import type {
  ExactCallableBodyInspection,
  ExactCallImplementations,
} from "../callable/result-inputs.js";
import type { TypeScriptActiveCooperativeEffectProfile } from "../../../profile.js";
import type { TypeScriptPlanningObserver } from "../../../planning-observer.js";
import {
  createExactAggregateProjectionIndex,
  type ExactAggregateProjectionIndex,
} from "../aggregate/projection.js";
import {
  createExactObjectPropertyProjectionIndex,
  type ExactObjectPropertyProjectionIndex,
} from "../object/projection.js";
import type { ClosedStorageOwnerAnalysis } from "../storage/analysis.js";
import { collectInterfaceEffectContracts } from "./contracts.js";
import { createAbstractInvocationTransports } from "./abstract-transport.js";
import { createInterfaceStorageBoundaryDependencies } from "./storage-dependencies.js";

export interface InterfaceContractFlowIndexes {
  readonly invocationInputs: ExactInvocationInputIndex;
  readonly exactCallImplementations?: ExactCallImplementations;
  readonly callableReferenceIsClosed?: (reference: Node) => boolean;
  readonly aggregateProjections: ExactAggregateProjectionIndex;
  readonly objectProjections?: ExactObjectPropertyProjectionIndex;
  readonly storageOwners?: ClosedStorageOwnerAnalysis;
  readonly bodyInspectionIsCertified?: ExactCallableBodyInspection;
}

export interface InterfaceContractEntry {
  readonly declaration: Node;
  readonly calls: readonly Node[];
  readonly implementations: readonly Node[];
  readonly implementationReturnRewrites: readonly CallableReturnRewrite[];
  readonly implementationReturnContractBlockers: readonly Node[];
  readonly returnRewrite: CallableReturnRewrite;
}

export interface InterfaceAbstractTransportEntry {
  readonly declaration: Node;
  readonly calls: readonly Node[];
  readonly implementations: readonly Node[];
}

export interface InterfaceContractComponent {
  readonly entries: readonly InterfaceContractEntry[];
  readonly abstractTransports: readonly InterfaceAbstractTransportEntry[];
  readonly boundary: boolean;
  readonly boundaryCauses: readonly InterfaceContractBoundaryCause[];
}

export interface InterfaceContractGraph {
  readonly consideredCount: number;
  readonly components: readonly InterfaceContractComponent[];
  readonly boundaryCauses: readonly InterfaceContractBoundaryCause[];
  readonly invocationInputs: ExactInvocationInputIndex;
  readonly invocationTransportCalls: readonly Node[];
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
  cooperativeEffects: TypeScriptActiveCooperativeEffectProfile = "closed-direct",
  planningObserver?: TypeScriptPlanningObserver,
): InterfaceContractGraph {
  let derivedTransports: InvocationTransportContract | undefined;
  let derivedCalls: readonly Node[] = Object.freeze([]);
  const maximumRounds = program.nodesOfKind(KindCallExpression).length + 1;
  for (let round = 0; round <= maximumRounds; round += 1) {
    const graph = createInterfaceContractGraphRound(
      source,
      program,
      composeInvocationTransportContracts([transports, derivedTransports]),
      sourceIdentityFor,
      indexes,
      cooperativeEffects,
      planningObserver,
    );
    if (!nodesAreSubset(derivedCalls, graph.invocationTransportCalls)) {
      throw new Error("abstract interface transport closure is not monotonic");
    }
    if (sameNodes(derivedCalls, graph.invocationTransportCalls)) {
      return graph;
    }
    derivedCalls = graph.invocationTransportCalls;
    derivedTransports = graph.invocationTransports;
  }
  throw new Error("abstract interface transport closure exceeded its finite domain");
}

function createInterfaceContractGraphRound(
  source: TargetSourceProgram,
  program: TargetProgramIndex,
  transports: InvocationTransportContract | undefined,
  sourceIdentityFor: SourceIdentityResolver,
  indexes: InterfaceContractFlowIndexes | undefined,
  cooperativeEffects: TypeScriptActiveCooperativeEffectProfile,
  planningObserver: TypeScriptPlanningObserver | undefined,
): InterfaceContractGraph {
  const contracts = collectContracts(
    source,
    program,
    sourceIdentityFor,
    indexes?.bodyInspectionIsCertified,
  );
  const aggregateProjections = indexes?.aggregateProjections ??
    createExactAggregateProjectionIndex(source, program);
  const objectProjections = indexes?.objectProjections ??
    createExactObjectPropertyProjectionIndex(
      source,
      program,
      cooperativeEffects,
    );
  const indirectInvocations =
    indexes === undefined
      ? createExactIndirectInvocationAnalysis(
          source,
          program,
          createExactInvocationInputIndex(
            source,
            program,
            aggregateProjections,
            cooperativeEffects,
          ),
          aggregateProjections,
          objectProjections,
          transports,
          undefined,
          planningObserver,
          undefined,
          undefined,
          undefined,
          "declared-interface",
          createInterfaceStorageBoundaryDependencies(
            source,
            new Set([...contracts.entries.keys()].flatMap((contract) => {
              const owner = source.ast.parent(contract);
              return owner !== undefined &&
                  source.ast.is.IsInterfaceDeclaration(owner)
                ? [owner]
                : [];
            })),
          ),
          undefined,
          cooperativeEffects,
        ).finalize()
      : undefined;
  const invocationInputs = indexes?.invocationInputs ??
    indirectInvocations?.invocationInputs;
  if (invocationInputs === undefined) {
    throw new Error("interface flow did not create an invocation-input index");
  }
  const exactCallImplementations = indexes?.exactCallImplementations ??
    indirectInvocations?.implementationsFor;
  planningObserver?.("effect-interface-contracts", {
    contracts: contracts.entries.size,
  });
  collectCalls(source, program, contracts.entries);
  planningObserver?.("effect-interface-calls", {
    values: [...contracts.entries.values()].reduce(
      (total, entry) => total + entry.calls.length,
      0,
    ),
  });
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
    cooperativeEffects,
    planningObserver,
    indexes?.storageOwners,
    indexes?.bodyInspectionIsCertified,
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
      if (entry.returnRewrite === undefined) {
        return [];
      }
      const implementations = contracts.implementations.implementationsFor(
        entry.declaration,
      );
      return [Object.freeze({
        declaration: entry.declaration,
        calls: Object.freeze([...entry.calls]),
        implementations,
        implementationReturnRewrites: Object.freeze(implementations.flatMap(
          (implementation) =>
            contracts.implementations.returnRewritesFor(implementation),
        )),
        implementationReturnContractBlockers: Object.freeze(
          implementations.flatMap((implementation) =>
            contracts.implementations.returnContractBlockersFor(implementation)
          ),
        ),
        returnRewrite: entry.returnRewrite,
      })];
    });
    const abstractTransports = declarations.flatMap((declaration) => {
      const entry = contracts.entries.get(declaration);
      return entry?.abstractTransport !== true ? [] : [Object.freeze({
        declaration: entry.declaration,
        calls: Object.freeze([...entry.calls]),
        implementations: contracts.implementations.implementationsFor(
          entry.declaration,
        ),
      })];
    });
    const boundaryCauses = contracts.boundaries.causesFor(declarations);
    components.push(Object.freeze({
      entries: Object.freeze(entries),
      abstractTransports: Object.freeze(abstractTransports),
      boundary: boundaryCauses.length !== 0,
      boundaryCauses,
    }));
  }
  const boundaryCauses = contracts.boundaries.causesFor(consideredDeclarations);
  const abstractTransports = createAbstractInvocationTransports(
    source,
    contracts,
    indexes?.bodyInspectionIsCertified,
  );
  planningObserver?.("effect-interface-components", {
    boundaries: boundaryCauses.length,
    components: components.length,
    contracts: consideredDeclarations.length,
  });
  return Object.freeze({
    consideredCount: seeds.length,
    components: Object.freeze(components),
    boundaryCauses,
    invocationInputs: completeInvocationInputs,
    invocationTransportCalls: abstractTransports?.calls ?? Object.freeze([]),
    ...(abstractTransports === undefined
      ? {}
      : { invocationTransports: abstractTransports.contract }),
  });
}

function sameNodes(left: readonly Node[], right: readonly Node[]): boolean {
  return left.length === right.length && nodesAreSubset(left, right);
}

function nodesAreSubset(left: readonly Node[], right: readonly Node[]): boolean {
  const selected = new Set(right);
  return left.every((node) => selected.has(node));
}

function collectContracts(
  source: TargetSourceProgram,
  program: TargetProgramIndex,
  sourceIdentityFor: SourceIdentityResolver,
  bodyInspectionIsCertified?: ExactCallableBodyInspection,
): InterfaceContractIndex {
  const entries = new Map<Node, MutableInterfaceContractEntry>();
  const links = new Map<Node, Set<Node>>();
  for (const contract of collectInterfaceEffectContracts(
    source,
    program,
    bodyInspectionIsCertified,
  )) {
    entries.set(contract.declaration, {
      declaration: contract.declaration,
      calls: [],
      returnRewrite: contract.returnRewrite,
      abstractTransport: false,
    });
    links.set(contract.declaration, new Set());
  }
  for (const declaration of program.nodesOfKind(KindMethodDeclaration)) {
    const owner = source.ast.parent(declaration);
    const typeNode = source.ast.typeNode(declaration);
    const abstractTransport = source.ast.is.IsMethodDeclaration(declaration) &&
      owner !== undefined &&
      source.ast.is.IsClassDeclaration(owner) &&
      source.ast.hasModifierKind(owner, "abstract") &&
      source.ast.hasModifierKind(declaration, "abstract") &&
      source.ast.body(declaration) === undefined;
    if (
      owner === undefined ||
      !abstractTransport ||
      !isExactInterfaceSourceDeclaration(
        source,
        owner,
        bodyInspectionIsCertified,
      ) ||
      !isExactInterfaceSourceDeclaration(
        source,
        declaration,
        bodyInspectionIsCertified,
      ) ||
      typeNode === undefined
    ) {
      continue;
    }
    entries.set(declaration, {
      declaration,
      calls: [],
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
    bodyInspectionIsCertified,
  );
  return {
    entries,
    declarationContracts: collectDeclarationContracts(
      source,
      program,
      entries,
      boundaries,
      implementations,
      bodyInspectionIsCertified,
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
  bodyInspectionIsCertified?: ExactCallableBodyInspection,
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
      bodyInspectionIsCertified,
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
  bodyInspectionIsCertified?: ExactCallableBodyInspection,
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
      if (
        edge.target.project ||
        isExactInterfaceSourceDeclaration(
          source,
          edge.target.declaration,
          bodyInspectionIsCertified,
        )
      ) {
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
