import type { Node, SourceFile } from "@tsonic/tsts";
import type { TargetSourceProgram } from "@tsonic/target-api";
import {
  AsClassDeclaration,
  AsNewExpression,
  AsPropertyAccessExpression,
  IsClassDeclaration,
  IsConstructorDeclaration,
  IsExportSpecifier,
  IsImportSpecifier,
  IsNewExpression,
  IsPropertyAccessExpression,
  IsPropertyDeclaration,
  IsSpreadElement,
  IsTypeQueryNode,
  IsTypeReferenceNode,
  KindClassDeclaration,
  KindNewExpression,
  KindPropertyAccessExpression,
} from "@tsonic/tsts/target-ast";

import type { TargetProgramIndex } from "../program-index.js";
import type { SourceIdentityResolver } from "../occurrence.js";
import {
  createOptimizationRetentionLedger,
  type BoundedOptimizationReasonEvidence,
} from "../retention-evidence.js";
import type { ScalarPrimitiveKind } from "./portable-type.js";
import {
  resolveStoredScalarFlow,
  type StoredScalarFlow,
} from "./stored-flow.js";

export const scalarClassRetentionReasons = Object.freeze([
  "profile-preserved",
  "observable-class-member",
  "observable-class-value",
  "open-construction",
  "open-projection",
  "observable-instance-value",
  "nonportable-type",
] as const);

export type ScalarClassRetentionReason =
  typeof scalarClassRetentionReasons[number];

export interface ScalarClassShapeProof {
  readonly constructorDeclaration: Node;
  readonly parameterDeclaration: Node;
  readonly resultTypeNode: Node;
  readonly portableResultType?: ScalarPrimitiveKind;
}

export type ScalarClassShapeResolution =
  | { readonly kind: "proved"; readonly proof: ScalarClassShapeProof }
  | { readonly kind: "retained" };

export interface ScalarClassFlow {
  readonly declaration: Node;
  readonly proof: ScalarClassShapeProof;
  readonly typeReferences: readonly Node[];
  readonly stored: StoredScalarFlow;
}

export type ScalarClassRewrite =
  | { readonly kind: "declaration"; readonly flow: ScalarClassFlow }
  | { readonly kind: "type-reference"; readonly flow: ScalarClassFlow }
  | { readonly kind: "construction"; readonly flow: ScalarClassFlow }
  | { readonly kind: "projection"; readonly flow: ScalarClassFlow };

export interface ScalarClassFlowPlan {
  readonly candidateCount: number;
  readonly loweredCount: number;
  readonly retainedCount: number;
  readonly flows: readonly ScalarClassFlow[];
  readonly fallbackReasons: readonly BoundedOptimizationReasonEvidence<
    ScalarClassRetentionReason
  >[];
  rewriteFor(node: Node): ScalarClassRewrite | undefined;
  rewritesFor(sourceFile: SourceFile): readonly Node[];
}

type ShapeResolver = (declaration: Node) => ScalarClassShapeResolution;

interface Candidate {
  readonly declaration: Node;
  readonly proof: ScalarClassShapeProof;
}

interface CandidateUses {
  readonly constructions: readonly Node[];
  readonly projections: readonly Node[];
  readonly typeReferences: readonly Node[];
  readonly unsupportedClassValue: boolean;
  readonly unsupportedConstruction: boolean;
  readonly unsupportedProjection: boolean;
}

const noNodes = Object.freeze([]) as readonly Node[];

export function createScalarClassFlowPlan(
  source: TargetSourceProgram,
  program: TargetProgramIndex,
  profile: "preserve" | "closed-direct",
  resolveShape: ShapeResolver,
  optimizedConstructions: ReadonlySet<Node>,
  optimizedProjections: ReadonlySet<Node>,
  sourceIdentityFor: SourceIdentityResolver,
): ScalarClassFlowPlan {
  const candidates = collectCandidates(source, program, resolveShape);
  const retentions = createOptimizationRetentionLedger(
    source,
    sourceIdentityFor,
    scalarClassRetentionReasons,
  );
  const flows: ScalarClassFlow[] = [];
  if (profile === "preserve") {
    for (const candidate of candidates) {
      retentions.record("profile-preserved", candidate.declaration);
    }
    return sealClassPlan(
      source,
      candidates.length,
      flows,
      retentions.count,
      retentions.seal(),
    );
  }
  const uses = indexCandidateUses(source, program, candidates);
  for (const candidate of candidates) {
    const selected = uses.get(candidate.declaration);
    if (selected === undefined) {
      throw new Error("scalar class candidate lost its exact use ledger");
    }
    const fixedReason = classMemberRetention(source, candidate);
    const useResolution = fixedReason === undefined
      ? resolveClassUse(
          source,
          program,
          selected,
          candidate,
          optimizedConstructions,
          optimizedProjections,
        )
      : undefined;
    const reason = fixedReason ??
      (useResolution?.kind === "retained" ? useResolution.reason : undefined);
    if (reason !== undefined) {
      retentions.record(reason, candidate.declaration);
      continue;
    }
    if (useResolution?.kind !== "proved") {
      throw new Error("scalar class use resolution disappeared");
    }
    flows.push(Object.freeze({
      declaration: candidate.declaration,
      proof: candidate.proof,
      typeReferences: selected.typeReferences,
      stored: useResolution.flow,
    }));
  }
  return sealClassPlan(
    source,
    candidates.length,
    flows,
    retentions.count,
    retentions.seal(),
  );
}

function collectCandidates(
  source: TargetSourceProgram,
  program: TargetProgramIndex,
  resolveShape: ShapeResolver,
): readonly Candidate[] {
  const candidates: Candidate[] = [];
  for (const declaration of program.nodesOfKind(KindClassDeclaration)) {
    if (!IsClassDeclaration(declaration)) {
      throw new Error("class index contains a non-class node");
    }
    const resolution = resolveShape(declaration);
    if (resolution.kind !== "proved") {
      continue;
    }
    const classDeclaration = AsClassDeclaration(declaration);
    if (
      classDeclaration?.name === undefined ||
      source.navigation.sourceReferenceFor(classDeclaration.name)?.declaration !==
        declaration
    ) {
      continue;
    }
    candidates.push(Object.freeze({
      declaration,
      proof: resolution.proof,
    }));
  }
  return Object.freeze(candidates);
}

function classMemberRetention(
  source: TargetSourceProgram,
  candidate: Candidate,
): ScalarClassRetentionReason | undefined {
  if (source.ast.hasModifierKind(candidate.declaration, "default")) {
    return "observable-class-value";
  }
  for (const member of source.ast.members(candidate.declaration)) {
    if (member === undefined || IsConstructorDeclaration(member)) {
      continue;
    }
    if (
      !IsPropertyDeclaration(member) ||
      !source.ast.hasModifierKind(member, "ambient") ||
      source.ast.body(member) !== undefined ||
      source.ast.children(member).some((child) =>
        child !== undefined && source.ast.kindName(child) === "KindDecorator"
      )
    ) {
      return "observable-class-member";
    }
  }
  return undefined;
}

function indexCandidateUses(
  source: TargetSourceProgram,
  program: TargetProgramIndex,
  candidates: readonly Candidate[],
): ReadonlyMap<Node, CandidateUses> {
  const byDeclaration = new Map(candidates.map((candidate) => [
    candidate.declaration,
    mutableUses(),
  ] as const));
  const byField = new Map(candidates.map((candidate) => [
    candidate.proof.parameterDeclaration,
    candidate.declaration,
  ] as const));
  const constructionOwner = new Map<Node, Node>();
  for (const node of program.nodesOfKind(KindNewExpression)) {
    const construction = AsNewExpression(node);
    const target = construction?.Expression;
    const declaration = source.navigation.sourceReferenceFor(target)?.declaration;
    const owner = declaration === undefined ? undefined : byDeclaration.get(declaration);
    if (owner === undefined || declaration === undefined) {
      continue;
    }
    constructionOwner.set(node, declaration);
    if (constructionIsExact(source, node, candidates, declaration)) {
      owner.constructions.push(node);
    } else {
      owner.unsupportedConstruction = true;
    }
  }
  const projectionOwner = new Map<Node, Node>();
  for (const node of program.nodesOfKind(KindPropertyAccessExpression)) {
    const access = AsPropertyAccessExpression(node);
    const property = source.semantics.forNode(node)
      .getResolvedPropertyAccessInfo(node);
    const declaration = property?.selectedDeclaration;
    const classDeclaration = declaration === undefined
      ? undefined
      : byField.get(declaration);
    const owner = classDeclaration === undefined
      ? undefined
      : byDeclaration.get(classDeclaration);
    if (owner === undefined || classDeclaration === undefined) {
      continue;
    }
    projectionOwner.set(node, classDeclaration);
    if (
      access !== undefined &&
      property?.expression === node &&
      property.accessMode === "read" &&
      !property.optionalChain &&
      !property.callCallee
    ) {
      owner.projections.push(node);
    } else {
      owner.unsupportedProjection = true;
    }
  }
  for (const candidate of candidates) {
    const owner = byDeclaration.get(candidate.declaration);
    if (owner === undefined) {
      throw new Error("scalar class use index lost a candidate");
    }
    auditClassReferences(
      source,
      program,
      candidate,
      constructionOwner,
      owner,
    );
    auditFieldReferences(source, program, candidate, projectionOwner, owner);
  }
  const sealed = new Map<Node, CandidateUses>();
  for (const [declaration, owner] of byDeclaration) {
    sealed.set(declaration, Object.freeze({
      constructions: Object.freeze(owner.constructions),
      projections: Object.freeze(owner.projections),
      typeReferences: Object.freeze([...owner.typeReferences]),
      unsupportedClassValue: owner.unsupportedClassValue,
      unsupportedConstruction: owner.unsupportedConstruction,
      unsupportedProjection: owner.unsupportedProjection,
    }));
  }
  return sealed;
}

interface MutableCandidateUses {
  constructions: Node[];
  projections: Node[];
  typeReferences: Set<Node>;
  unsupportedClassValue: boolean;
  unsupportedConstruction: boolean;
  unsupportedProjection: boolean;
}

function mutableUses(): MutableCandidateUses {
  return {
    constructions: [],
    projections: [],
    typeReferences: new Set(),
    unsupportedClassValue: false,
    unsupportedConstruction: false,
    unsupportedProjection: false,
  };
}

function constructionIsExact(
  source: TargetSourceProgram,
  node: Node,
  candidates: readonly Candidate[],
  declaration: Node,
): boolean {
  const candidate = candidates.find((entry) => entry.declaration === declaration);
  const construction = AsNewExpression(node);
  const argument = construction?.Arguments?.Nodes[0];
  if (
    candidate === undefined ||
    construction === undefined ||
    argument === undefined ||
    construction.Arguments?.Nodes.length !== 1 ||
    IsSpreadElement(argument)
  ) {
    return false;
  }
  const semantics = source.semantics.forNode(node);
  const call = semantics.getResolvedCallInfo(node);
  const parameter = call?.sourceSelectedSignatureParameters[0];
  const binding = call?.sourceArgumentBindings[0];
  return call?.outcome === "applicable" &&
    call.call === node &&
    !call.optionalChain &&
    call.sourceSelectedSignatureKind === "resolved" &&
    semantics.getSignatureDeclaration(call.selectedSignature) ===
      candidate.proof.constructorDeclaration &&
    call.sourceSelectedSignatureParameters.length === 1 &&
    parameter?.parameterDeclaration === candidate.proof.parameterDeclaration &&
    call.sourceArguments.length === 1 &&
    call.sourceArguments[0]?.expression === argument &&
    call.sourceArgumentBindings.length === 1 &&
    binding?.sourceArgumentIndex === 0 &&
    binding.effectiveArgumentIndex === 0 &&
    binding.sourceForm === "value" &&
    binding.sourceParameterIndex === 0 &&
    binding.sourceParameterForm === "parameter";
}

function auditClassReferences(
  source: TargetSourceProgram,
  program: TargetProgramIndex,
  candidate: Candidate,
  constructionOwner: ReadonlyMap<Node, Node>,
  owner: MutableCandidateUses,
): void {
  for (const reference of program.referencesToDeclaration(
    candidate.declaration,
  )) {
    const importSpecifier = ancestor(source, reference, IsImportSpecifier);
    if (importSpecifier !== undefined) {
      continue;
    }
    const exportSpecifier = ancestor(source, reference, IsExportSpecifier);
    if (exportSpecifier !== undefined) {
      continue;
    }
    const construction = ancestor(source, reference, IsNewExpression);
    if (
      construction !== undefined &&
      constructionOwner.get(construction) === candidate.declaration
    ) {
      continue;
    }
    const typeReference = plainTypeReference(source, reference);
    if (typeReference !== undefined) {
      owner.typeReferences.add(typeReference);
      continue;
    }
    owner.unsupportedClassValue = true;
  }
}

function auditFieldReferences(
  source: TargetSourceProgram,
  program: TargetProgramIndex,
  candidate: Candidate,
  projectionOwner: ReadonlyMap<Node, Node>,
  owner: MutableCandidateUses,
): void {
  for (const reference of program.referencesToDeclaration(
    candidate.proof.parameterDeclaration,
  )) {
    const projection = ancestor(source, reference, IsPropertyAccessExpression);
    if (
      projection === undefined ||
      projectionOwner.get(projection) !== candidate.declaration
    ) {
      owner.unsupportedProjection = true;
    }
  }
}

function plainTypeReference(
  source: TargetSourceProgram,
  reference: Node,
): Node | undefined {
  let current: Node | undefined = reference;
  while (current !== undefined) {
    if (IsTypeQueryNode(current)) {
      return undefined;
    }
    if (IsTypeReferenceNode(current)) {
      return current;
    }
    current = source.ast.parent(current);
  }
  return undefined;
}

function ancestor(
  source: TargetSourceProgram,
  start: Node,
  predicate: (node: Node) => boolean,
): Node | undefined {
  let current: Node | undefined = start;
  while (current !== undefined) {
    if (predicate(current)) {
      return current;
    }
    current = source.ast.parent(current);
  }
  return undefined;
}

function resolveClassUse(
  source: TargetSourceProgram,
  program: TargetProgramIndex,
  uses: CandidateUses | undefined,
  candidate: Candidate,
  optimizedConstructions: ReadonlySet<Node>,
  optimizedProjections: ReadonlySet<Node>,
):
  | { readonly kind: "proved"; readonly flow: StoredScalarFlow }
  | { readonly kind: "retained"; readonly reason: ScalarClassRetentionReason } {
  if (uses === undefined) {
    throw new Error("scalar class candidate has no use decision");
  }
  if (uses.unsupportedClassValue) {
    return { kind: "retained", reason: "observable-class-value" };
  }
  if (uses.unsupportedConstruction) {
    return { kind: "retained", reason: "open-construction" };
  }
  if (uses.unsupportedProjection) {
    return { kind: "retained", reason: "open-projection" };
  }
  if (candidate.proof.portableResultType === undefined) {
    return { kind: "retained", reason: "nonportable-type" };
  }
  return resolveStoredScalarFlow(
    source,
    program,
    uses.constructions,
    uses.projections,
    optimizedConstructions,
    optimizedProjections,
  );
}

function sealClassPlan(
  source: TargetSourceProgram,
  candidateCount: number,
  flows: readonly ScalarClassFlow[],
  retainedCount: number,
  fallbackReasons: readonly BoundedOptimizationReasonEvidence<
    ScalarClassRetentionReason
  >[],
): ScalarClassFlowPlan {
  if (
    flows.length + retainedCount !== candidateCount ||
    fallbackReasons.reduce((sum, row) => sum + row.count, 0) !== retainedCount
  ) {
    throw new Error("scalar class decisions do not partition the denominator");
  }
  const rewrites = new Map<Node, ScalarClassRewrite>();
  const byFile = new Map<SourceFile, Node[]>();
  for (const flow of flows) {
    addRewrite(source, rewrites, byFile, flow.declaration, {
      kind: "declaration",
      flow,
    });
    for (const node of flow.typeReferences) {
      addRewrite(source, rewrites, byFile, node, {
        kind: "type-reference",
        flow,
      });
    }
    for (const node of flow.stored.constructions) {
      addRewrite(source, rewrites, byFile, node, {
        kind: "construction",
        flow,
      });
    }
    for (const node of flow.stored.projections) {
      addRewrite(source, rewrites, byFile, node, {
        kind: "projection",
        flow,
      });
    }
  }
  const sealedByFile = new Map<SourceFile, readonly Node[]>();
  for (const [sourceFile, nodes] of byFile) {
    sealedByFile.set(sourceFile, Object.freeze(nodes));
  }
  return Object.freeze({
    candidateCount,
    loweredCount: flows.length,
    retainedCount,
    flows: Object.freeze([...flows]),
    fallbackReasons,
    rewriteFor(node: Node): ScalarClassRewrite | undefined {
      return rewrites.get(node);
    },
    rewritesFor(sourceFile: SourceFile): readonly Node[] {
      return sealedByFile.get(sourceFile) ?? noNodes;
    },
  });
}

function addRewrite(
  source: TargetSourceProgram,
  rewrites: Map<Node, ScalarClassRewrite>,
  byFile: Map<SourceFile, Node[]>,
  node: Node,
  rewrite: ScalarClassRewrite,
): void {
  if (rewrites.has(node)) {
    throw new Error("one scalar class node cannot have two rewrites");
  }
  const sourceFile = source.ast.getSourceFile(node);
  if (sourceFile === undefined) {
    throw new Error("scalar class rewrite has no source file");
  }
  rewrites.set(node, Object.freeze(rewrite));
  const selected = byFile.get(sourceFile);
  if (selected === undefined) {
    byFile.set(sourceFile, [node]);
  } else {
    selected.push(node);
  }
}
