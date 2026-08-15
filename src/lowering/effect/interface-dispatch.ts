import type { Node } from "@tsonic/tsts";
import type { TargetSourceProgram } from "@tsonic/target-api";
import {
  KindCallExpression,
  KindClassDeclaration,
  KindClassExpression,
} from "@tsonic/tsts/target-ast";

import type { TargetProgramIndex } from "../program-index.js";
import type { TypeScriptInterfaceDispatchProfile } from "../profile.js";
import {
  callableReturnRewrite,
  type CallableReturnRewrite,
} from "./callable-contract.js";
import type { CooperativeEffectCandidate } from "./candidate-inventory.js";
import {
  blockCooperativeEffect,
  type CooperativeEffectFallbackReason,
} from "./fallback.js";
import {
  callableBodyResultIsDefinitelyNonThenable,
} from "./synchronous.js";

export interface DeclaredInterfaceDispatchFamily {
  readonly contractDeclaration: Node;
  readonly calls: readonly Node[];
  readonly implementations: readonly Node[];
  readonly candidates: readonly CooperativeEffectCandidate[];
  readonly coordinator?: CooperativeEffectCandidate;
  readonly returnRewrite: CallableReturnRewrite;
}

export interface DeclaredInterfaceDispatch {
  readonly profile: TypeScriptInterfaceDispatchProfile;
  readonly consideredFamilyCount: number;
  readonly rejectedFamilyCount: number;
  readonly families: readonly DeclaredInterfaceDispatchFamily[];
  readonly calls: ReadonlyMap<Node, DeclaredInterfaceDispatchFamily>;
  addDependencies(
    owner: CooperativeEffectCandidate,
    family: DeclaredInterfaceDispatchFamily,
  ): void;
  block(
    family: DeclaredInterfaceDispatchFamily,
    reason: CooperativeEffectFallbackReason,
    occurrence: Node,
  ): void;
  callIsSettled(call: Node, optimized: ReadonlySet<Node>): boolean;
  settledReturnTypes(
    optimized: ReadonlySet<Node>,
  ): readonly CallableReturnRewrite[];
  evidence(optimized: ReadonlySet<Node>): InterfaceDispatchEvidence;
}

export type InterfaceDispatchEvidence =
  | {
      readonly profile: "open-structural";
      readonly analyzed: false;
    }
  | {
      readonly profile: "declared-closed";
      readonly analyzed: false;
    }
  | {
      readonly profile: "declared-closed";
      readonly analyzed: true;
      readonly consideredFamilyCount: number;
      readonly admittedFamilyCount: number;
      readonly rejectedFamilyCount: number;
      readonly admittedCallCount: number;
      readonly implementationCount: number;
      readonly candidateImplementationCount: number;
      readonly settledFamilyCount: number;
      readonly retainedFamilyCount: number;
      readonly settledCallCount: number;
    };

interface PendingFamily {
  readonly contractDeclaration: Node;
  readonly calls: Node[];
  readonly returnRewrite: CallableReturnRewrite;
}

interface HeritageIndex {
  readonly implementers: ReadonlyMap<Node, readonly Node[]>;
  readonly complete: boolean;
}

export function createDeclaredInterfaceDispatch(
  source: TargetSourceProgram,
  program: TargetProgramIndex,
  candidates: ReadonlyMap<Node, CooperativeEffectCandidate>,
  profile: TypeScriptInterfaceDispatchProfile,
): DeclaredInterfaceDispatch {
  if (profile === "open-structural") {
    return createResult(profile, 0, 0, []);
  }
  const pending = collectPendingFamilies(source, program);
  const heritage = collectHeritageIndex(source, program);
  const families: DeclaredInterfaceDispatchFamily[] = [];
  let rejectedFamilyCount = 0;
  for (const selected of pending.values()) {
    const family = heritage.complete
      ? resolveFamily(source, candidates, heritage, selected)
      : undefined;
    if (family === undefined) {
      rejectedFamilyCount += 1;
      continue;
    }
    connectFamily(family.candidates);
    families.push(family);
  }
  return createResult(
    profile,
    pending.size,
    rejectedFamilyCount,
    families,
  );
}

function collectPendingFamilies(
  source: TargetSourceProgram,
  program: TargetProgramIndex,
): ReadonlyMap<Node, PendingFamily> {
  const result = new Map<Node, PendingFamily>();
  for (const call of program.nodesOfKind(KindCallExpression)) {
    const semantics = source.semantics.forNode(call);
    const declaration = semantics.getSignatureDeclaration(
      semantics.getResolvedSignature(call),
    );
    const owner = declaration === undefined
      ? undefined
      : source.ast.parent(declaration);
    const typeNode = declaration === undefined
      ? undefined
      : source.ast.typeNode(declaration);
    const returnRewrite = typeNode === undefined
      ? undefined
      : callableReturnRewrite(source, typeNode);
    if (
      declaration === undefined ||
      owner === undefined ||
      returnRewrite === undefined ||
      !source.ast.is.IsMethodSignatureDeclaration(declaration) ||
      !source.ast.is.IsInterfaceDeclaration(owner) ||
      !source.navigation.isProjectDeclaration(declaration) ||
      !source.navigation.isProjectDeclaration(owner)
    ) {
      continue;
    }
    const existing = result.get(declaration);
    if (existing === undefined) {
      result.set(declaration, {
        contractDeclaration: declaration,
        calls: [call],
        returnRewrite,
      });
    } else {
      existing.calls.push(call);
    }
  }
  return result;
}

function collectHeritageIndex(
  source: TargetSourceProgram,
  program: TargetProgramIndex,
): HeritageIndex {
  const implementers = new Map<Node, Node[]>();
  const closures = new Map<Node, ReadonlySet<Node> | null>();
  let complete = true;
  for (const declaration of program.nodesOfKinds([
    KindClassDeclaration,
    KindClassExpression,
  ])) {
    if (source.ast.hasModifierKind(declaration, "abstract")) {
      continue;
    }
    const closure = declaredHeritageClosure(
      source,
      declaration,
      closures,
      new Set(),
    );
    if (closure === undefined) {
      complete = false;
      continue;
    }
    for (const contract of closure) {
      const selected = implementers.get(contract);
      if (selected === undefined) {
        implementers.set(contract, [declaration]);
      } else {
        selected.push(declaration);
      }
    }
  }
  return Object.freeze({ implementers, complete });
}

function declaredHeritageClosure(
  source: TargetSourceProgram,
  declaration: Node,
  cache: Map<Node, ReadonlySet<Node> | null>,
  pending: Set<Node>,
): ReadonlySet<Node> | undefined {
  const cached = cache.get(declaration);
  if (cached !== undefined) {
    return cached ?? undefined;
  }
  if (pending.has(declaration)) {
    cache.set(declaration, null);
    return undefined;
  }
  pending.add(declaration);
  const heritage = source.navigation.declaredHeritage(declaration);
  if (heritage.kind === "unresolved") {
    pending.delete(declaration);
    cache.set(declaration, null);
    return undefined;
  }
  const closure = new Set<Node>();
  for (const edge of heritage.edges) {
    closure.add(edge.target.declaration);
    const inherited = declaredHeritageClosure(
      source,
      edge.target.declaration,
      cache,
      pending,
    );
    if (inherited === undefined) {
      pending.delete(declaration);
      cache.set(declaration, null);
      return undefined;
    }
    for (const inheritedDeclaration of inherited) {
      closure.add(inheritedDeclaration);
    }
  }
  pending.delete(declaration);
  const result = Object.freeze(closure);
  cache.set(declaration, result);
  return result;
}

function resolveFamily(
  source: TargetSourceProgram,
  candidates: ReadonlyMap<Node, CooperativeEffectCandidate>,
  heritage: HeritageIndex,
  pending: PendingFamily,
): DeclaredInterfaceDispatchFamily | undefined {
  const owner = source.ast.parent(pending.contractDeclaration);
  if (owner === undefined) {
    return undefined;
  }
  const classes = heritage.implementers.get(owner) ?? [];
  if (classes.length === 0) {
    return undefined;
  }
  const implementations = new Set<Node>();
  const selectedCandidates = new Set<CooperativeEffectCandidate>();
  for (const declaration of classes) {
    if (!source.ast.is.IsClassDeclaration(declaration)) {
      return undefined;
    }
    const selected = source.navigation.memberImplementation(
      declaration,
      pending.contractDeclaration,
    );
    if (selected.kind !== "resolved") {
      return undefined;
    }
    const implementation = selected.implementation.declaration;
    implementations.add(implementation);
    const candidate = candidates.get(implementation);
    if (candidate !== undefined) {
      selectedCandidates.add(candidate);
      continue;
    }
    if (!callableBodyResultIsDefinitelyNonThenable(source, implementation)) {
      return undefined;
    }
  }
  const candidateList = Object.freeze([...selectedCandidates]);
  return Object.freeze({
    contractDeclaration: pending.contractDeclaration,
    calls: Object.freeze([...pending.calls]),
    implementations: Object.freeze([...implementations]),
    candidates: candidateList,
    ...(candidateList[0] === undefined
      ? {}
      : { coordinator: candidateList[0] }),
    returnRewrite: pending.returnRewrite,
  });
}

function connectFamily(
  candidates: readonly CooperativeEffectCandidate[],
): void {
  const coordinator = candidates[0];
  if (coordinator === undefined) {
    return;
  }
  for (const candidate of candidates.slice(1)) {
    coordinator.dependencies.add(candidate);
    candidate.dependencies.add(coordinator);
  }
}

function createResult(
  profile: TypeScriptInterfaceDispatchProfile,
  consideredFamilyCount: number,
  rejectedFamilyCount: number,
  families: readonly DeclaredInterfaceDispatchFamily[],
): DeclaredInterfaceDispatch {
  const calls = new Map<Node, DeclaredInterfaceDispatchFamily>();
  for (const family of families) {
    for (const call of family.calls) {
      if (calls.has(call)) {
        throw new Error("interface call belongs to multiple declared families");
      }
      calls.set(call, family);
    }
  }
  return Object.freeze({
    profile,
    consideredFamilyCount,
    rejectedFamilyCount,
    families: Object.freeze([...families]),
    calls,
    addDependencies(
      owner: CooperativeEffectCandidate,
      family: DeclaredInterfaceDispatchFamily,
    ): void {
      if (family.coordinator !== undefined) {
        owner.dependencies.add(family.coordinator);
      }
    },
    block(
      family: DeclaredInterfaceDispatchFamily,
      reason: CooperativeEffectFallbackReason,
      occurrence: Node,
    ): void {
      if (family.coordinator !== undefined) {
        blockCooperativeEffect(family.coordinator, reason, occurrence);
      }
    },
    callIsSettled(call: Node, optimized: ReadonlySet<Node>): boolean {
      const family = calls.get(call);
      return family !== undefined && family.candidates.every((candidate) =>
        optimized.has(candidate.declaration)
      );
    },
    settledReturnTypes(
      optimized: ReadonlySet<Node>,
    ): readonly CallableReturnRewrite[] {
      return Object.freeze(families.flatMap((family) =>
        family.candidates.every((candidate) =>
            optimized.has(candidate.declaration)
          )
          ? [family.returnRewrite]
          : []
      ));
    },
    evidence(optimized: ReadonlySet<Node>): InterfaceDispatchEvidence {
      if (profile === "open-structural") {
        return Object.freeze({ profile, analyzed: false });
      }
      const settled = families.filter((family) =>
        family.candidates.every((candidate) =>
          optimized.has(candidate.declaration)
        )
      );
      return Object.freeze({
        profile,
        analyzed: true,
        consideredFamilyCount,
        admittedFamilyCount: families.length,
        rejectedFamilyCount,
        admittedCallCount: calls.size,
        implementationCount: families.reduce(
          (total, family) => total + family.implementations.length,
          0,
        ),
        candidateImplementationCount: families.reduce(
          (total, family) => total + family.candidates.length,
          0,
        ),
        settledFamilyCount: settled.length,
        retainedFamilyCount: families.length - settled.length,
        settledCallCount: settled.reduce(
          (total, family) => total + family.calls.length,
          0,
        ),
      });
    },
  });
}
