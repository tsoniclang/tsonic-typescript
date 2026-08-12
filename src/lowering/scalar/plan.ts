import type {
  Node,
  SourceFile,
} from "@tsonic/tsts";
import type {
  TargetSourceProgram,
} from "@tsonic/target-api";
import {
  AsClassDeclaration,
  AsConstructorDeclaration,
  AsNewExpression,
  AsParameterDeclaration,
  AsPropertyAccessExpression,
  AsPropertyDeclaration,
  IsBlock,
  IsClassDeclaration,
  IsClassStaticBlockDeclaration,
  IsConstructorDeclaration,
  IsDecorator,
  IsGetAccessorDeclaration,
  IsIdentifier,
  IsMethodDeclaration,
  IsNewExpression,
  IsPropertyAccessExpression,
  IsPropertyDeclaration,
  IsSemicolonClassElement,
  IsSetAccessorDeclaration,
  IsSpreadElement,
  KindPropertyAccessExpression,
} from "@tsonic/tsts/target-ast";
import type { TargetProgramIndex } from "../program-index.js";
import {
  portableScalarKind,
  scalarPrimitiveKind,
  type ScalarPrimitiveKind,
} from "./portable-type.js";

export type { ScalarPrimitiveKind } from "./portable-type.js";

export type ScalarRepresentationProfile = "preserve" | "closed-direct";

export const scalarProjectionRetentionReasons = Object.freeze([
  "profile-preserved",
  "open-constructor-target",
  "mutable-class-binding",
  "observable-construction",
  "nonreadonly-scalar-field",
  "non-scalar-value",
  "nonportable-cross-module-type",
  "open-call-or-projection",
] as const);

export type ScalarProjectionRetentionReason =
  typeof scalarProjectionRetentionReasons[number];

export type ScalarProjectionResultType =
  | { readonly kind: "authored"; readonly node: Node }
  | { readonly kind: "primitive"; readonly primitive: ScalarPrimitiveKind };

export interface ScalarProjectionPlan {
  readonly access: Node;
  readonly construction: Node;
  readonly constructorTarget: Node;
  readonly argument: Node;
  readonly classDeclaration: Node;
  readonly constructorDeclaration: Node;
  readonly fieldDeclaration: Node;
  readonly resultType: ScalarProjectionResultType;
}

export type ScalarProjectionDecision =
  | {
      readonly kind: "optimized";
      readonly access: Node;
      readonly projection: ScalarProjectionPlan;
    }
  | ScalarProjectionRetention;

export interface ScalarProjectionRetention {
  readonly kind: "retained";
  readonly access: Node;
  readonly reason: ScalarProjectionRetentionReason;
}

export interface ScalarRepresentationPlan {
  readonly profile: ScalarRepresentationProfile;
  readonly moduleBoundary: "open" | "closed";
  readonly syntacticProjectionCount: number;
  readonly projectionCount: number;
  readonly retainedProjectionCount: number;
  readonly decisions: readonly ScalarProjectionDecision[];
  readonly retentions: readonly ScalarProjectionRetention[];
  owns(source: TargetSourceProgram): boolean;
  decisionFor(access: Node): ScalarProjectionDecision | undefined;
  projectionFor(access: Node): ScalarProjectionPlan | undefined;
  projectionsFor(sourceFile: SourceFile): readonly ScalarProjectionPlan[];
}

interface TransparentClassProof {
  readonly constructorDeclaration: Node;
  readonly parameterDeclaration: Node;
  readonly resultTypeNode: Node;
  readonly portableResultType?: ScalarPrimitiveKind;
}

type TransparentClassResolution =
  | { readonly kind: "proved"; readonly proof: TransparentClassProof }
  | { readonly kind: "retained"; readonly reason: ScalarProjectionRetentionReason };

const noProjections = Object.freeze([]) as readonly ScalarProjectionPlan[];

export function createScalarRepresentationPlan(
  source: TargetSourceProgram,
  program: TargetProgramIndex,
  profile: ScalarRepresentationProfile,
): ScalarRepresentationPlan {
  if (profile !== "preserve" && profile !== "closed-direct") {
    throw new Error(`unsupported scalar representation profile '${String(profile)}'`);
  }
  let syntacticProjectionCount = 0;
  const classProofs = new Map<Node, TransparentClassResolution>();
  const portableScalarKinds = new Map<Node, ScalarPrimitiveKind | undefined>();
  const decisions: ScalarProjectionDecision[] = [];
  for (const node of program.nodesOfKind(KindPropertyAccessExpression)) {
    if (!isSyntacticProjection(node)) {
      continue;
    }
    syntacticProjectionCount += 1;
    decisions.push(
      profile === "closed-direct"
        ? resolveProjection(
        source,
        program,
        node,
        classProofs,
        portableScalarKinds,
      )
        : retainProjection(node, "profile-preserved"),
    );
  }
  return sealPlan(
    source,
    profile,
    syntacticProjectionCount,
    decisions,
  );
}

function sealPlan(
  source: TargetSourceProgram,
  profile: ScalarRepresentationProfile,
  syntacticProjectionCount: number,
  decisions: readonly ScalarProjectionDecision[],
): ScalarRepresentationPlan {
  if (decisions.length !== syntacticProjectionCount) {
    throw new Error(
      `scalar decision mismatch: candidates ${syntacticProjectionCount}, decisions ${decisions.length}`,
    );
  }
  const byDecision = new Map<Node, ScalarProjectionDecision>();
  const byAccess = new Map<Node, ScalarProjectionPlan>();
  const byFile = new Map<SourceFile, ScalarProjectionPlan[]>();
  const projections: ScalarProjectionPlan[] = [];
  const retentions: ScalarProjectionRetention[] = [];
  for (const decision of decisions) {
    if (byDecision.has(decision.access)) {
      throw new Error("one scalar projection cannot be decided twice");
    }
    byDecision.set(decision.access, decision);
    if (decision.kind === "retained") {
      retentions.push(decision);
      continue;
    }
    const projection = decision.projection;
    projections.push(projection);
    byAccess.set(projection.access, projection);
    const sourceFile = source.ast.getSourceFile(projection.access);
    if (sourceFile === undefined) {
      throw new Error("planned scalar projection has no source file");
    }
    const fileProjections = byFile.get(sourceFile);
    if (fileProjections === undefined) {
      byFile.set(sourceFile, [projection]);
    } else {
      fileProjections.push(projection);
    }
  }
  if (projections.length + retentions.length !== syntacticProjectionCount) {
    throw new Error("scalar decisions do not partition the exact denominator");
  }
  const sealedByFile = new Map<SourceFile, readonly ScalarProjectionPlan[]>();
  for (const [sourceFile, fileProjections] of byFile) {
    sealedByFile.set(sourceFile, Object.freeze([...fileProjections]));
  }
  return Object.freeze({
    profile,
    moduleBoundary: profile === "closed-direct" ? "closed" : "open",
    syntacticProjectionCount,
    projectionCount: projections.length,
    retainedProjectionCount: retentions.length,
    decisions: Object.freeze([...decisions]),
    retentions: Object.freeze(retentions),
    owns(candidate: TargetSourceProgram): boolean {
      return candidate === source;
    },
    decisionFor(access: Node): ScalarProjectionDecision | undefined {
      return byDecision.get(access);
    },
    projectionFor(access: Node): ScalarProjectionPlan | undefined {
      return byAccess.get(access);
    },
    projectionsFor(sourceFile: SourceFile): readonly ScalarProjectionPlan[] {
      return sealedByFile.get(sourceFile) ?? noProjections;
    },
  });
}

function isSyntacticProjection(node: Node): boolean {
  if (!IsPropertyAccessExpression(node)) {
    return false;
  }
  const access = AsPropertyAccessExpression(node);
  if (
    access === undefined ||
    access.QuestionDotToken !== undefined ||
    access.Expression === undefined ||
    !IsNewExpression(access.Expression)
  ) {
    return false;
  }
  const construction = AsNewExpression(access.Expression);
  const arguments_ = construction?.Arguments?.Nodes ?? [];
  return arguments_.length === 1 &&
    arguments_[0] !== undefined &&
    !IsSpreadElement(arguments_[0]);
}

function resolveProjection(
  source: TargetSourceProgram,
  program: TargetProgramIndex,
  node: Node,
  classProofs: Map<Node, TransparentClassResolution>,
  portableScalarKinds: Map<Node, ScalarPrimitiveKind | undefined>,
): ScalarProjectionDecision {
  const access = AsPropertyAccessExpression(node);
  const construction = access?.Expression === undefined
    ? undefined
    : AsNewExpression(access.Expression);
  const constructorTarget = construction?.Expression;
  const argument = construction?.Arguments?.Nodes[0];
  if (
    access === undefined ||
    construction === undefined ||
    constructorTarget === undefined ||
    argument === undefined ||
    !IsIdentifier(constructorTarget)
  ) {
    return retainProjection(node, "open-constructor-target");
  }
  const reference = source.navigation.sourceReferenceFor(constructorTarget);
  if (
    reference === undefined ||
    !reference.project ||
    !IsClassDeclaration(reference.declaration)
  ) {
    return retainProjection(node, "open-constructor-target");
  }
  const classDeclaration = reference.declaration;
  const classSourceFile = source.ast.getSourceFile(classDeclaration);
  const useSourceFile = source.ast.getSourceFile(node);
  if (classSourceFile === undefined || useSourceFile === undefined) {
    return retainProjection(node, "open-constructor-target");
  }
  const sameSourceFile = classSourceFile === useSourceFile;
  let classResolution = classProofs.get(classDeclaration);
  if (!classProofs.has(classDeclaration)) {
    classResolution = proveTransparentClass(
      source,
      program,
      classDeclaration,
      portableScalarKinds,
    );
    classProofs.set(classDeclaration, classResolution);
  }
  if (classResolution === undefined) {
    throw new Error("scalar class proof cache lost its exact decision");
  }
  if (classResolution.kind === "retained") {
    return retainProjection(node, classResolution.reason);
  }
  const classProof = classResolution.proof;
  let resultType: ScalarProjectionResultType;
  if (sameSourceFile) {
    resultType = Object.freeze({
      kind: "authored",
      node: classProof.resultTypeNode,
    });
  } else {
    const portable = classProof.portableResultType;
    if (portable === undefined) {
      return retainProjection(node, "nonportable-cross-module-type");
    }
    resultType = Object.freeze({ kind: "primitive", primitive: portable });
  }

  const semantics = source.semantics.forNode(node);
  const property = semantics.getResolvedPropertyAccessInfo(node);
  const call = semantics.getResolvedCallInfo(construction);
  const selectedParameter = call?.sourceSelectedSignatureParameters[0];
  const argumentBinding = call?.sourceArgumentBindings[0];
  const sourceArgument = call?.sourceArguments[0];
  if (
    property === undefined ||
    property.expression !== node ||
    property.receiver.expression !== construction ||
    property.selectedDeclaration !== classProof.parameterDeclaration ||
    property.accessMode !== "read" ||
    property.optionalChain ||
    property.callCallee ||
    call?.outcome !== "applicable" ||
    call.call !== construction ||
    call.optionalChain ||
    call.sourceSelectedSignatureKind !== "resolved" ||
    semantics.getSignatureDeclaration(call.selectedSignature) !==
      classProof.constructorDeclaration ||
    call.sourceSelectedSignatureParameters.length !== 1 ||
    selectedParameter === undefined ||
    selectedParameter.parameterIndex !== 0 ||
    selectedParameter.parameterDeclaration !== classProof.parameterDeclaration ||
    selectedParameter.authoredTypeNode !== classProof.resultTypeNode ||
    call.sourceArguments.length !== 1 ||
    sourceArgument?.expression !== argument ||
    call.sourceArgumentBindings.length !== 1 ||
    argumentBinding === undefined ||
    argumentBinding.sourceArgumentIndex !== 0 ||
    argumentBinding.effectiveArgumentIndex !== 0 ||
    argumentBinding.sourceForm !== "value" ||
    argumentBinding.sourceParameterIndex !== 0 ||
    argumentBinding.sourceParameterForm !== "parameter" ||
    semantics.getTypeRelationship(
      property.sourceReadType,
      selectedParameter.selectedType,
    ) !== "identical" ||
    semantics.getTypeRelationship(
      argumentBinding.selectedParameterType,
      selectedParameter.selectedType,
    ) !== "identical"
  ) {
    return retainProjection(node, "open-call-or-projection");
  }
  const projection: ScalarProjectionPlan = Object.freeze({
    access: node,
    construction,
    constructorTarget,
    argument,
    classDeclaration,
    constructorDeclaration: classProof.constructorDeclaration,
    fieldDeclaration: classProof.parameterDeclaration,
    resultType,
  });
  return Object.freeze({
    kind: "optimized",
    access: node,
    projection,
  });
}

function proveTransparentClass(
  source: TargetSourceProgram,
  program: TargetProgramIndex,
  declaration: Node,
  portableScalarKinds: Map<Node, ScalarPrimitiveKind | undefined>,
): TransparentClassResolution {
  const classDeclaration = AsClassDeclaration(declaration);
  if (
    classDeclaration === undefined ||
    classDeclaration.name === undefined
  ) {
    return retainClass("open-constructor-target");
  }
  if (
    source.ast.extendsHeritageElements(declaration).length !== 0 ||
    hasDecorator(source, declaration) ||
    source.ast.hasModifierKind(declaration, "abstract") ||
    source.ast.hasModifierKind(declaration, "ambient") ||
    !classMembersAreProjectionSafe(source, declaration)
  ) {
    return retainClass("observable-construction");
  }
  const classReference = source.navigation.sourceReferenceFor(
    classDeclaration.name,
  );
  if (
    classReference === undefined ||
    !classReference.project ||
    classReference.declaration !== declaration
  ) {
    return retainClass("open-constructor-target");
  }
  if (program.bindingWritesFor(declaration).length !== 0) {
    return retainClass("mutable-class-binding");
  }
  const constructors = source.ast.members(declaration).filter((member) =>
    member !== undefined && IsConstructorDeclaration(member)
  );
  if (constructors.length !== 1) {
    return retainClass("observable-construction");
  }
  const constructorDeclaration = constructors[0];
  const constructor = AsConstructorDeclaration(constructorDeclaration);
  const body = source.ast.body(constructorDeclaration);
  const parameters = source.ast.parameters(constructorDeclaration);
  if (
    constructorDeclaration === undefined ||
    constructor === undefined ||
    body === undefined ||
    !IsBlock(body) ||
    source.ast.statements(body).length !== 0 ||
    parameters.length !== 1
  ) {
    return retainClass("observable-construction");
  }
  const parameterDeclaration = parameters[0];
  const parameter = AsParameterDeclaration(parameterDeclaration);
  if (
    parameterDeclaration === undefined ||
    parameter === undefined ||
    !IsIdentifier(parameter.name) ||
    parameter.Type === undefined ||
    parameter.Initializer !== undefined ||
    parameter.DotDotDotToken !== undefined ||
    parameter.QuestionToken !== undefined ||
    !source.ast.hasModifierKind(parameterDeclaration, "readonly") ||
    hasDecorator(source, parameterDeclaration)
  ) {
    return retainClass("nonreadonly-scalar-field");
  }
  const constructorsEvidence = source.navigation.classConstructors(declaration);
  if (
    constructorsEvidence.kind !== "resolved" ||
    constructorsEvidence.implicit ||
    constructorsEvidence.declaration !== declaration ||
    constructorsEvidence.signatures.length !== 1
  ) {
    return retainClass("open-call-or-projection");
  }
  const signature = constructorsEvidence.signatures[0];
  const selectedParameter = signature?.parameters[0];
  if (
    signature === undefined ||
    signature.declaration !== constructorDeclaration ||
    signature.parameters.length !== 1 ||
    selectedParameter === undefined ||
    selectedParameter.parameterDeclaration !== parameterDeclaration ||
    selectedParameter.authoredTypeNode !== parameter.Type
  ) {
    return retainClass("open-call-or-projection");
  }
  const semantics = source.semantics.forNode(declaration);
  const scalarKind = scalarPrimitiveKind(
    semantics,
    selectedParameter.selectedType,
  );
  if (scalarKind === undefined) {
    return retainClass("non-scalar-value");
  }
  const portableKind = portableScalarKind(
    source,
    parameter.Type,
    portableScalarKinds,
  );
  const portableResultType = portableKind === scalarKind
    ? portableKind
    : undefined;
  return Object.freeze({
    kind: "proved",
    proof: Object.freeze({
      constructorDeclaration,
      parameterDeclaration,
      resultTypeNode: parameter.Type,
      ...(portableResultType === undefined ? {} : { portableResultType }),
    }),
  });
}

function classMembersAreProjectionSafe(
  source: TargetSourceProgram,
  declaration: Node,
): boolean {
  for (const member of source.ast.members(declaration)) {
    if (member === undefined || hasDecorator(source, member)) {
      return false;
    }
    if (IsConstructorDeclaration(member) || IsSemicolonClassElement(member)) {
      continue;
    }
    if (IsClassStaticBlockDeclaration(member)) {
      return false;
    }
    if (IsPropertyDeclaration(member)) {
      const property = AsPropertyDeclaration(member);
      if (
        property === undefined ||
        property.Initializer !== undefined
      ) {
        return false;
      }
      continue;
    }
    if (
      IsMethodDeclaration(member) ||
      IsGetAccessorDeclaration(member) ||
      IsSetAccessorDeclaration(member)
    ) {
      continue;
    }
    return false;
  }
  return true;
}

function retainProjection(
  access: Node,
  reason: ScalarProjectionRetentionReason,
): ScalarProjectionRetention {
  return Object.freeze({ kind: "retained", access, reason });
}

function retainClass(
  reason: ScalarProjectionRetentionReason,
): TransparentClassResolution {
  return Object.freeze({ kind: "retained", reason });
}

function hasDecorator(source: TargetSourceProgram, node: Node): boolean {
  return source.ast.modifiers(node).some((modifier) => IsDecorator(modifier));
}
