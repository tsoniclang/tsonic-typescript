import type { Node, SourceFile } from "@tsonic/tsts";
import type { TargetSourceProgram } from "@tsonic/target-api";
import {
  KindFunctionDeclaration,
  KindMethodDeclaration,
} from "@tsonic/tsts/target-ast";

import type { TargetProgramIndex } from "../program-index.js";
import type { SourceIdentityResolver } from "../occurrence.js";
import {
  createOptimizationRetentionLedger,
  type BoundedOptimizationReasonEvidence,
} from "../retention-evidence.js";
import type { RepresentationProjectionProfile } from "./plan.js";
import { classValueReferencesAreClosed } from "./shape.js";

export const identityCallableRetentionReasons = Object.freeze([
  "profile-preserved",
  "mutable-parameter",
  "open-parameter-use",
  "open-owner-call",
  "nonidentity-input",
  "overlapping-rewrite",
] as const);

export type IdentityCallableRetentionReason =
  typeof identityCallableRetentionReasons[number];

export interface IdentityCallableSpecialization {
  readonly owner: Node;
  readonly parameter: Node;
  readonly parameterIndex: number;
  readonly parameterCalls: readonly Node[];
  readonly ownerCalls: readonly Node[];
}

export interface IdentityCallablePlan {
  readonly candidateCount: number;
  readonly optimizedCount: number;
  readonly retainedCount: number;
  readonly specializations: readonly IdentityCallableSpecialization[];
  readonly fallbackReasons: readonly BoundedOptimizationReasonEvidence<
    IdentityCallableRetentionReason
  >[];
  specializationsForOwner(owner: Node): readonly IdentityCallableSpecialization[];
  specializationsForOwnerCall(call: Node): readonly IdentityCallableSpecialization[];
  specializationForParameterCall(call: Node): IdentityCallableSpecialization | undefined;
  specializationsFor(sourceFile: SourceFile): readonly IdentityCallableSpecialization[];
  belongsToFile(node: Node, sourceFile: SourceFile): boolean;
}

const noSpecializations = Object.freeze([]) as readonly IdentityCallableSpecialization[];

export function createIdentityCallablePlan(
  source: TargetSourceProgram,
  program: TargetProgramIndex,
  profile: RepresentationProjectionProfile,
  blockedCalls: ReadonlySet<Node>,
  sourceIdentityFor: SourceIdentityResolver,
): IdentityCallablePlan {
  const specializations: IdentityCallableSpecialization[] = [];
  const retentions = createOptimizationRetentionLedger(
    source,
    sourceIdentityFor,
    identityCallableRetentionReasons,
  );
  let candidateCount = 0;
  for (const owner of program.nodesOfKinds([
    KindFunctionDeclaration,
    KindMethodDeclaration,
  ])) {
    if (!supportedOwner(source, program, owner)) {
      continue;
    }
    const parameters = source.ast.parameters(owner).filter(
      (parameter): parameter is Node => parameter !== undefined,
    );
    for (let parameterIndex = 0; parameterIndex < parameters.length; parameterIndex += 1) {
      const parameter = parameters[parameterIndex];
      if (parameter === undefined || !isCallableParameter(source, parameter)) {
        continue;
      }
      candidateCount += 1;
      if (profile === "preserve") {
        retentions.record("profile-preserved", parameter);
        continue;
      }
      const decision = resolveSpecialization(
        source,
        program,
        owner,
        parameter,
        parameterIndex,
        blockedCalls,
      );
      if (decision.kind === "proved") {
        specializations.push(decision.specialization);
      } else {
        retentions.record(decision.reason, parameter);
      }
    }
  }
  return sealIdentityCallablePlan(
    source,
    candidateCount,
    specializations,
    retentions.count,
    retentions.seal(),
  );
}

type SpecializationResolution =
  | { readonly kind: "proved"; readonly specialization: IdentityCallableSpecialization }
  | { readonly kind: "retained"; readonly reason: IdentityCallableRetentionReason };

function resolveSpecialization(
  source: TargetSourceProgram,
  program: TargetProgramIndex,
  owner: Node,
  parameter: Node,
  parameterIndex: number,
  blockedCalls: ReadonlySet<Node>,
): SpecializationResolution {
  if (program.hasBindingWrite(parameter)) {
    return { kind: "retained", reason: "mutable-parameter" };
  }
  const parameterReferences = program.referencesToDeclaration(parameter);
  const parameterCalls = parameterReferences.map((reference) =>
    directParameterCallForReference(source, reference)
  );
  if (
    parameterReferences.length === 0 ||
    parameterCalls.some((call) => call === undefined)
  ) {
    return { kind: "retained", reason: "open-parameter-use" };
  }
  const ownerReferences = program.referencesToDeclaration(owner)
    .filter((reference) => !isModuleForwardingReference(source, reference));
  const ownerCalls = ownerReferences.map((reference) =>
    directOwnerCallForReference(source, reference)
  );
  if (
    ownerReferences.length === 0 ||
    ownerCalls.some((call) => call === undefined) ||
    ownerCalls.some((call) =>
      call === undefined || !selectedCallOwns(source, call, owner)
    )
  ) {
    return { kind: "retained", reason: "open-owner-call" };
  }
  if (ownerCalls.some((call) => call !== undefined && blockedCalls.has(call))) {
    return { kind: "retained", reason: "overlapping-rewrite" };
  }
  for (const call of ownerCalls) {
    const arguments_ = call === undefined
      ? []
      : source.ast.as.AsCallExpression(call)?.Arguments?.Nodes ?? [];
    const input = arguments_[parameterIndex];
    if (
      input === undefined ||
      source.ast.is.IsSpreadElement(input) ||
      !isExactIdentityValue(source, program, input)
    ) {
      return { kind: "retained", reason: "nonidentity-input" };
    }
  }
  return {
    kind: "proved",
    specialization: Object.freeze({
      owner,
      parameter,
      parameterIndex,
      parameterCalls: Object.freeze(parameterCalls.filter(
        (call): call is Node => call !== undefined,
      )),
      ownerCalls: Object.freeze(ownerCalls.filter(
        (call): call is Node => call !== undefined,
      )),
    }),
  };
}

function sealIdentityCallablePlan(
  source: TargetSourceProgram,
  candidateCount: number,
  specializations: readonly IdentityCallableSpecialization[],
  retainedCount: number,
  fallbackReasons: readonly BoundedOptimizationReasonEvidence<
    IdentityCallableRetentionReason
  >[],
): IdentityCallablePlan {
  if (
    specializations.length + retainedCount !== candidateCount ||
    fallbackReasons.reduce((sum, row) => sum + row.count, 0) !== retainedCount
  ) {
    throw new Error("identity-callable decisions do not partition their denominator");
  }
  const byOwner = groupSpecializations(specializations, (value) => [value.owner]);
  const byOwnerCall = groupSpecializations(specializations, (value) => value.ownerCalls);
  const byParameterCall = new Map<Node, IdentityCallableSpecialization>();
  const byFile = groupSpecializations(specializations, (value) =>
    uniqueSourceFiles(source, [
      value.owner,
      ...value.parameterCalls,
      ...value.ownerCalls,
    ])
  );
  for (const specialization of specializations) {
    for (const call of specialization.parameterCalls) {
      if (byParameterCall.has(call)) {
        throw new Error("one parameter call cannot belong to two specializations");
      }
      byParameterCall.set(call, specialization);
    }
  }
  return Object.freeze({
    candidateCount,
    optimizedCount: specializations.length,
    retainedCount,
    specializations: Object.freeze([...specializations]),
    fallbackReasons,
    specializationsForOwner(owner: Node) {
      return byOwner.get(owner) ?? noSpecializations;
    },
    specializationsForOwnerCall(call: Node) {
      return byOwnerCall.get(call) ?? noSpecializations;
    },
    specializationForParameterCall(call: Node) {
      return byParameterCall.get(call);
    },
    specializationsFor(sourceFile: SourceFile) {
      return byFile.get(sourceFile) ?? noSpecializations;
    },
    belongsToFile(node: Node, sourceFile: SourceFile) {
      return source.ast.getSourceFile(node) === sourceFile;
    },
  });
}

function groupSpecializations<Key extends Node>(
  values: readonly IdentityCallableSpecialization[],
  keys: (value: IdentityCallableSpecialization) => readonly Key[],
): ReadonlyMap<Key, readonly IdentityCallableSpecialization[]> {
  const groups = new Map<Key, IdentityCallableSpecialization[]>();
  for (const value of values) {
    for (const key of keys(value)) {
      const group = groups.get(key);
      if (group === undefined) {
        groups.set(key, [value]);
      } else {
        group.push(value);
      }
    }
  }
  return new Map([...groups].map(([key, group]) => [
    key,
    Object.freeze([...group].sort((left, right) =>
      left.parameterIndex - right.parameterIndex
    )),
  ]));
}

function supportedOwner(
  source: TargetSourceProgram,
  program: TargetProgramIndex,
  owner: Node,
): boolean {
  if (
    source.ast.body(owner) === undefined ||
    program.hasBindingWrite(owner)
  ) {
    return false;
  }
  if (source.ast.is.IsFunctionDeclaration(owner)) {
    const declaration = source.ast.as.AsFunctionDeclaration(owner);
    return declaration?.name !== undefined &&
      declaration.FullSignature === undefined &&
      declaration.AsteriskToken === undefined;
  }
  if (!source.ast.is.IsMethodDeclaration(owner)) {
    return false;
  }
  const method = source.ast.as.AsMethodDeclaration(owner);
  const parent = source.ast.parent(owner);
  return method !== undefined &&
    method.FullSignature === undefined &&
    method.AsteriskToken === undefined &&
    source.ast.hasModifierKind(owner, "static") &&
    parent !== undefined &&
    source.ast.is.IsClassDeclaration(parent) &&
    source.ast.extendsHeritageElements(parent).length === 0 &&
    !program.hasBindingWrite(parent) &&
    classValueReferencesAreClosed(source, program, parent);
}

function isCallableParameter(
  source: TargetSourceProgram,
  parameter: Node,
): boolean {
  const parsed = source.ast.as.AsParameterDeclaration(parameter);
  const typeNode = source.ast.typeNode(parameter);
  if (
    parsed === undefined ||
    typeNode === undefined ||
    parsed.DotDotDotToken !== undefined ||
    parsed.QuestionToken !== undefined ||
    parsed.Initializer !== undefined
  ) {
    return false;
  }
  const semantics = source.semantics.forNode(typeNode);
  const type = semantics.getTypeFromTypeNode(typeNode);
  return type !== undefined && semantics.getCallSignatures(type).length !== 0;
}

function directParameterCallForReference(
  source: TargetSourceProgram,
  reference: Node,
): Node | undefined {
  const parent = source.ast.parent(reference);
  const call = parent !== undefined && source.ast.is.IsCallExpression(parent)
    ? source.ast.as.AsCallExpression(parent)
    : undefined;
  const arguments_ = call?.Arguments?.Nodes ?? [];
  return call?.Expression === reference &&
      call.QuestionDotToken === undefined &&
      arguments_.length === 1 &&
      arguments_[0] !== undefined &&
      !arguments_.some((argument) =>
        argument !== undefined && source.ast.is.IsSpreadElement(argument)
      )
    ? parent
    : undefined;
}

function directOwnerCallForReference(
  source: TargetSourceProgram,
  reference: Node,
): Node | undefined {
  const parent = source.ast.parent(reference);
  const call = parent !== undefined && source.ast.is.IsCallExpression(parent)
    ? source.ast.as.AsCallExpression(parent)
    : undefined;
  const arguments_ = call?.Arguments?.Nodes ?? [];
  return call?.Expression === reference &&
      call.QuestionDotToken === undefined &&
      !arguments_.some((argument) =>
        argument !== undefined && source.ast.is.IsSpreadElement(argument)
      )
    ? parent
    : undefined;
}

function selectedCallOwns(
  source: TargetSourceProgram,
  call: Node,
  declaration: Node,
): boolean {
  const semantics = source.semantics.forNode(call);
  const info = semantics.getResolvedCallInfo(call);
  return info?.outcome === "applicable" &&
    info.sourceSelectedSignatureKind === "resolved" &&
    !info.optionalChain &&
    semantics.getSignatureDeclaration(info.selectedSignature) === declaration;
}

function isExactIdentityValue(
  source: TargetSourceProgram,
  program: TargetProgramIndex,
  expression: Node,
): boolean {
  const declaration = source.ast.is.IsIdentifier(expression)
    ? source.navigation.sourceReferenceFor(expression)?.declaration
    : expression;
  if (declaration === undefined || program.hasBindingWrite(declaration)) {
    return false;
  }
  if (!isSupportedIdentityFunction(source, declaration)) {
    return false;
  }
  const parameters = source.ast.parameters(declaration).filter(
    (parameter): parameter is Node => parameter !== undefined,
  );
  const parameter = parameters[0];
  const returned = identityReturnedExpression(source, declaration);
  return parameter !== undefined &&
    parameters.length === 1 &&
    plainRequiredParameter(source, parameter) &&
    returned !== undefined &&
    source.ast.is.IsIdentifier(returned) &&
    source.navigation.sourceReferenceFor(returned)?.declaration === parameter;
}

function isSupportedIdentityFunction(
  source: TargetSourceProgram,
  declaration: Node,
): boolean {
  if (source.ast.hasModifierKind(declaration, "async")) {
    return false;
  }
  if (source.ast.is.IsFunctionDeclaration(declaration)) {
    const parsed = source.ast.as.AsFunctionDeclaration(declaration);
    return parsed !== undefined &&
      parsed.AsteriskToken === undefined &&
      parsed.FullSignature === undefined;
  }
  if (source.ast.is.IsFunctionExpression(declaration)) {
    const parsed = source.ast.as.AsFunctionExpression(declaration);
    return parsed !== undefined &&
      parsed.AsteriskToken === undefined &&
      parsed.FullSignature === undefined;
  }
  if (source.ast.is.IsArrowFunction(declaration)) {
    const parsed = source.ast.as.AsArrowFunction(declaration);
    return parsed !== undefined && parsed.FullSignature === undefined;
  }
  return false;
}

function identityReturnedExpression(
  source: TargetSourceProgram,
  declaration: Node,
): Node | undefined {
  const body = source.ast.body(declaration);
  if (body === undefined) {
    return undefined;
  }
  if (!source.ast.is.IsBlock(body)) {
    return body;
  }
  const statements = source.ast.statements(body);
  return statements.length === 1 && statements[0] !== undefined &&
      source.ast.is.IsReturnStatement(statements[0])
    ? source.ast.as.AsReturnStatement(statements[0])?.Expression
    : undefined;
}

function plainRequiredParameter(
  source: TargetSourceProgram,
  parameter: Node,
): boolean {
  const parsed = source.ast.as.AsParameterDeclaration(parameter);
  return parsed !== undefined &&
    parsed.DotDotDotToken === undefined &&
    parsed.QuestionToken === undefined &&
    parsed.Initializer === undefined &&
    source.ast.is.IsIdentifier(parsed.name);
}

function uniqueSourceFiles(
  source: TargetSourceProgram,
  nodes: readonly Node[],
): readonly SourceFile[] {
  const files = new Set<SourceFile>();
  for (const node of nodes) {
    const sourceFile = source.ast.getSourceFile(node);
    if (sourceFile === undefined) {
      throw new Error("identity-callable specialization has no source file");
    }
    files.add(sourceFile);
  }
  return Object.freeze([...files]);
}

function isModuleForwardingReference(
  source: TargetSourceProgram,
  reference: Node,
): boolean {
  let current = source.ast.parent(reference);
  while (current !== undefined) {
    if (
      source.ast.is.IsImportClause(current) ||
      source.ast.is.IsImportSpecifier(current) ||
      source.ast.is.IsNamespaceImport(current) ||
      source.ast.is.IsExportSpecifier(current) ||
      source.ast.is.IsImportDeclaration(current) ||
      source.ast.is.IsExportDeclaration(current)
    ) {
      return true;
    }
    if (!source.ast.is.IsNamedImports(current)) {
      return false;
    }
    current = source.ast.parent(current);
  }
  return false;
}
