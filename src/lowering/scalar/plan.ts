import type {
  Node,
  SourceFile,
  Type,
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
} from "@tsonic/tsts/target-ast";

export type ScalarRepresentationProfile = "preserve" | "closed-direct";

export interface ScalarProjectionPlan {
  readonly access: Node;
  readonly construction: Node;
  readonly constructorTarget: Node;
  readonly argument: Node;
  readonly classDeclaration: Node;
  readonly constructorDeclaration: Node;
  readonly fieldDeclaration: Node;
  readonly resultTypeNode: Node;
}

export interface ScalarRepresentationPlan {
  readonly profile: ScalarRepresentationProfile;
  readonly moduleBoundary: "open" | "closed";
  readonly syntacticProjectionCount: number;
  readonly projectionCount: number;
  readonly retainedProjectionCount: number;
  projectionFor(access: Node): ScalarProjectionPlan | undefined;
  projectionsFor(sourceFile: SourceFile): readonly ScalarProjectionPlan[];
}

interface TransparentClassProof {
  readonly constructorDeclaration: Node;
  readonly parameterDeclaration: Node;
  readonly selectedType: Type;
  readonly resultTypeNode: Node;
}

const noProjections = Object.freeze([]) as readonly ScalarProjectionPlan[];

export function createScalarRepresentationPlan(
  source: TargetSourceProgram,
  profile: ScalarRepresentationProfile,
): ScalarRepresentationPlan {
  if (profile !== "preserve" && profile !== "closed-direct") {
    throw new Error(`unsupported scalar representation profile '${String(profile)}'`);
  }
  const nodes = collectProgramNodes(source);
  const syntactic = nodes.filter((node) => isSyntacticProjection(node));
  if (profile === "preserve") {
    return sealPlan(source, profile, syntactic.length, []);
  }

  const classProofs = new Map<Node, TransparentClassProof | undefined>();
  const projections: ScalarProjectionPlan[] = [];
  for (const node of syntactic) {
    const projection = resolveProjection(source, node, classProofs);
    if (projection !== undefined) {
      projections.push(projection);
    }
  }
  return sealPlan(source, profile, syntactic.length, projections);
}

function sealPlan(
  source: TargetSourceProgram,
  profile: ScalarRepresentationProfile,
  syntacticProjectionCount: number,
  projections: readonly ScalarProjectionPlan[],
): ScalarRepresentationPlan {
  const byAccess = new Map<Node, ScalarProjectionPlan>();
  const byFile = new Map<SourceFile, ScalarProjectionPlan[]>();
  for (const projection of projections) {
    if (byAccess.has(projection.access)) {
      throw new Error("one scalar projection cannot be planned twice");
    }
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
  const sealedByFile = new Map<SourceFile, readonly ScalarProjectionPlan[]>();
  for (const [sourceFile, fileProjections] of byFile) {
    sealedByFile.set(sourceFile, Object.freeze([...fileProjections]));
  }
  return Object.freeze({
    profile,
    moduleBoundary: profile === "closed-direct" ? "closed" : "open",
    syntacticProjectionCount,
    projectionCount: projections.length,
    retainedProjectionCount: syntacticProjectionCount - projections.length,
    projectionFor(access: Node): ScalarProjectionPlan | undefined {
      return byAccess.get(access);
    },
    projectionsFor(sourceFile: SourceFile): readonly ScalarProjectionPlan[] {
      return sealedByFile.get(sourceFile) ?? noProjections;
    },
  });
}

function collectProgramNodes(source: TargetSourceProgram): readonly Node[] {
  const nodes: Node[] = [];
  const seen = new Set<Node>();
  const pending: Node[] = [...source.sourceFiles].reverse();
  while (pending.length > 0) {
    const node = pending.pop();
    if (node === undefined || seen.has(node)) {
      continue;
    }
    seen.add(node);
    nodes.push(node);
    const children = source.ast.children(node);
    for (let index = children.length - 1; index >= 0; index -= 1) {
      const child = children[index];
      if (child !== undefined) {
        pending.push(child);
      }
    }
  }
  return Object.freeze(nodes);
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
  node: Node,
  classProofs: Map<Node, TransparentClassProof | undefined>,
): ScalarProjectionPlan | undefined {
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
    return undefined;
  }
  const reference = source.navigation.sourceReferenceFor(constructorTarget);
  if (
    reference === undefined ||
    !reference.project ||
    !IsClassDeclaration(reference.declaration) ||
    source.ast.getSourceFile(reference.declaration) !==
      source.ast.getSourceFile(node)
  ) {
    return undefined;
  }
  const classDeclaration = reference.declaration;
  let classProof = classProofs.get(classDeclaration);
  if (!classProofs.has(classDeclaration)) {
    classProof = proveTransparentClass(source, classDeclaration);
    classProofs.set(classDeclaration, classProof);
  }
  if (classProof === undefined) {
    return undefined;
  }

  const semantics = source.semantics.forNode(node);
  const property = semantics.getResolvedPropertyAccessInfo(node);
  if (
    property === undefined ||
    property.expression !== node ||
    property.receiver.expression !== construction ||
    property.selectedDeclaration !== classProof.parameterDeclaration ||
    property.accessMode !== "read" ||
    property.optionalChain ||
    property.callCallee ||
    semantics.getTypeRelationship(
      property.sourceReadType,
      classProof.selectedType,
    ) !== "identical"
  ) {
    return undefined;
  }
  const signature = semantics.getResolvedSignature(construction);
  if (
    signature === undefined ||
    semantics.getSignatureDeclaration(signature) !==
      classProof.constructorDeclaration
  ) {
    return undefined;
  }
  return Object.freeze({
    access: node,
    construction,
    constructorTarget,
    argument,
    classDeclaration,
    constructorDeclaration: classProof.constructorDeclaration,
    fieldDeclaration: classProof.parameterDeclaration,
    resultTypeNode: classProof.resultTypeNode,
  });
}

function proveTransparentClass(
  source: TargetSourceProgram,
  declaration: Node,
): TransparentClassProof | undefined {
  const classDeclaration = AsClassDeclaration(declaration);
  if (
    classDeclaration === undefined ||
    classDeclaration.name === undefined ||
    source.ast.extendsHeritageElements(declaration).length !== 0 ||
    hasDecorator(source, declaration) ||
    source.ast.hasModifierKind(declaration, "abstract") ||
    source.ast.hasModifierKind(declaration, "ambient") ||
    !classMembersAreProjectionSafe(source, declaration)
  ) {
    return undefined;
  }
  const constructors = source.ast.members(declaration).filter((member) =>
    member !== undefined && IsConstructorDeclaration(member)
  );
  if (constructors.length !== 1) {
    return undefined;
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
    return undefined;
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
    return undefined;
  }
  const constructorsEvidence = source.navigation.classConstructors(declaration);
  if (
    constructorsEvidence.kind !== "resolved" ||
    constructorsEvidence.implicit ||
    constructorsEvidence.declaration !== declaration ||
    constructorsEvidence.signatures.length !== 1
  ) {
    return undefined;
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
    return undefined;
  }
  const semantics = source.semantics.forNode(declaration);
  if (!isScalarType(semantics, selectedParameter.selectedType)) {
    return undefined;
  }
  return Object.freeze({
    constructorDeclaration,
    parameterDeclaration,
    selectedType: selectedParameter.selectedType,
    resultTypeNode: parameter.Type,
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

function isScalarType(
  semantics: ReturnType<TargetSourceProgram["semantics"]["forNode"]>,
  type: Type,
): boolean {
  return semantics.isNumberLike(type) ||
    semantics.isStringLike(type) ||
    semantics.isBooleanLike(type) ||
    semantics.isBigIntLike(type);
}

function hasDecorator(source: TargetSourceProgram, node: Node): boolean {
  return source.ast.modifiers(node).some((modifier) => IsDecorator(modifier));
}
