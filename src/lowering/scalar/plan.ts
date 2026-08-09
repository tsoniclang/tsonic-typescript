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
  IsBlock,
  IsCallExpression,
  IsClassDeclaration,
  IsConstructorDeclaration,
  IsDecorator,
  IsExpressionWithTypeArguments,
  IsIdentifier,
  IsInterfaceDeclaration,
  IsImportTypeNode,
  IsJsxOpeningElement,
  IsJsxSelfClosingElement,
  IsMethodDeclaration,
  IsNewExpression,
  IsPropertyAccessExpression,
  IsSemicolonClassElement,
  IsSpreadElement,
  IsTaggedTemplateExpression,
  IsTypeAliasDeclaration,
  IsTypeQueryNode,
  IsTypeReferenceNode,
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
  readonly provenComponentCount: number;
  readonly projectionCount: number;
  readonly retainedProjectionCount: number;
  projectionFor(access: Node): ScalarProjectionPlan | undefined;
  projectionsFor(sourceFile: SourceFile): readonly ScalarProjectionPlan[];
}

interface ProgramNodes {
  readonly all: readonly Node[];
}

interface TransparentClassProof {
  readonly declaration: Node;
  readonly constructorDeclaration: Node;
  readonly parameterDeclaration: Node;
  readonly selectedType: Type;
  readonly resultTypeNode: Node;
}

type ProjectionCandidate = ScalarProjectionPlan;

const noProjections = Object.freeze([]) as readonly ScalarProjectionPlan[];

export function createScalarRepresentationPlan(
  source: TargetSourceProgram,
  profile: ScalarRepresentationProfile,
): ScalarRepresentationPlan {
  if (profile !== "preserve" && profile !== "closed-direct") {
    throw new Error(`unsupported scalar representation profile '${String(profile)}'`);
  }
  const nodes = collectProgramNodes(source);
  const syntactic = nodes.all.filter((node) => isSyntacticProjection(node));
  if (profile === "preserve") {
    return sealPlan(source, profile, syntactic.length, 0, []);
  }

  const classProofs = new Map<Node, TransparentClassProof | undefined>();
  const candidates: ProjectionCandidate[] = [];
  for (const node of syntactic) {
    const candidate = resolveProjectionCandidate(source, node, classProofs);
    if (candidate !== undefined) {
      candidates.push(candidate);
    }
  }

  const byClass = groupCandidatesByClass(candidates);
  const typeOnlyNodes = collectTypeOnlyNodes(source, nodes.all);
  const references = collectCandidateClassReferences(
    source,
    nodes.all,
    new Set(byClass.keys()),
  );
  const admitted: ProjectionCandidate[] = [];
  let provenComponentCount = 0;
  for (const [classDeclaration, component] of byClass) {
    if (
      componentIsClosed(
        source,
        classDeclaration,
        component,
        references.get(classDeclaration) ?? noNodes,
        typeOnlyNodes,
      )
    ) {
      provenComponentCount += 1;
      admitted.push(...component);
    }
  }
  return sealPlan(
    source,
    profile,
    syntactic.length,
    provenComponentCount,
    admitted,
  );
}

const noNodes = Object.freeze([]) as readonly Node[];

function sealPlan(
  source: TargetSourceProgram,
  profile: ScalarRepresentationProfile,
  syntacticProjectionCount: number,
  provenComponentCount: number,
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
    provenComponentCount,
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

function collectProgramNodes(source: TargetSourceProgram): ProgramNodes {
  const all: Node[] = [];
  const seen = new Set<Node>();
  const pending: Node[] = [...source.sourceFiles].reverse();
  while (pending.length > 0) {
    const node = pending.pop();
    if (node === undefined || seen.has(node)) {
      continue;
    }
    seen.add(node);
    all.push(node);
    const children = source.ast.children(node);
    for (let index = children.length - 1; index >= 0; index -= 1) {
      const child = children[index];
      if (child !== undefined) {
        pending.push(child);
      }
    }
  }
  return { all: Object.freeze(all) };
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

function resolveProjectionCandidate(
  source: TargetSourceProgram,
  node: Node,
  classProofs: Map<Node, TransparentClassProof | undefined>,
): ProjectionCandidate | undefined {
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
    source.ast.implementsHeritageElements(declaration).length !== 0 ||
    hasDecorator(source, declaration) ||
    source.ast.hasModifierKind(declaration, "abstract") ||
    source.ast.hasModifierKind(declaration, "ambient") ||
    source.ast.hasModifierKind(declaration, "export") ||
    source.ast.hasModifierKind(declaration, "default")
  ) {
    return undefined;
  }
  const members = source.ast.members(declaration).filter(
    (member): member is Node => member !== undefined,
  );
  const constructors = members.filter((member) =>
    IsConstructorDeclaration(member)
  );
  if (
    constructors.length !== 1 ||
    members.some((member) =>
      !IsConstructorDeclaration(member) &&
      !IsMethodDeclaration(member) &&
      !IsSemicolonClassElement(member)
    ) ||
    members.some((member) => hasDecorator(source, member))
  ) {
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
    hasDecorator(source, constructorDeclaration) ||
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
    declaration,
    constructorDeclaration,
    parameterDeclaration,
    selectedType: selectedParameter.selectedType,
    resultTypeNode: parameter.Type,
  });
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

function groupCandidatesByClass(
  candidates: readonly ProjectionCandidate[],
): ReadonlyMap<Node, readonly ProjectionCandidate[]> {
  const result = new Map<Node, ProjectionCandidate[]>();
  for (const candidate of candidates) {
    const component = result.get(candidate.classDeclaration);
    if (component === undefined) {
      result.set(candidate.classDeclaration, [candidate]);
    } else {
      component.push(candidate);
    }
  }
  return result;
}

function collectCandidateClassReferences(
  source: TargetSourceProgram,
  nodes: readonly Node[],
  candidateClasses: ReadonlySet<Node>,
): ReadonlyMap<Node, readonly Node[]> {
  const references = new Map<Node, Node[]>();
  for (const node of nodes) {
    const reference = source.navigation.sourceReferenceFor(node);
    if (
      reference === undefined ||
      !candidateClasses.has(reference.declaration)
    ) {
      continue;
    }
    const classReferences = references.get(reference.declaration);
    if (classReferences === undefined) {
      references.set(reference.declaration, [node]);
    } else {
      classReferences.push(node);
    }
  }
  return references;
}

function componentIsClosed(
  source: TargetSourceProgram,
  classDeclaration: Node,
  component: readonly ProjectionCandidate[],
  references: readonly Node[],
  typeOnlyNodes: ReadonlySet<Node>,
): boolean {
  const classNode = AsClassDeclaration(classDeclaration);
  if (classNode?.name === undefined) {
    return false;
  }
  const permitted = new Set<Node>([
    classDeclaration,
    classNode.name,
  ]);
  for (const candidate of component) {
    permitted.add(candidate.access);
    permitted.add(candidate.construction);
    permitted.add(candidate.constructorTarget);
  }
  if (references.some((node) =>
    !permitted.has(node) && !typeOnlyNodes.has(node)
  )) {
    return false;
  }
  const symbol = source.semantics.forNode(classDeclaration)
    .getSymbolAtLocation(classNode.name);
  if (symbol === undefined) {
    return false;
  }
  return source.sourceFiles.every((sourceFile) =>
    source.navigation.bindingWritesWithin(symbol, sourceFile).length === 0
  );
}

function collectTypeOnlyNodes(
  source: TargetSourceProgram,
  nodes: readonly Node[],
): ReadonlySet<Node> {
  const result = new Set<Node>();
  for (const node of nodes) {
    markTypeSubtree(source, result, source.ast.typeNode(node));
    if (hasTypeArguments(node)) {
      for (const typeArgument of source.ast.typeArguments(node)) {
        markTypeSubtree(source, result, typeArgument);
      }
    }
    for (const heritage of source.ast.implementsHeritageElements(node)) {
      markTypeSubtree(source, result, heritage);
    }
    if (
      IsInterfaceDeclaration(node) ||
      IsTypeAliasDeclaration(node) ||
      source.ast.isTypeOnlyImportOrExportDeclaration(node)
    ) {
      markTypeSubtree(source, result, node);
    }
  }
  return result;
}

function hasTypeArguments(node: Node): boolean {
  return IsCallExpression(node) ||
    IsNewExpression(node) ||
    IsTaggedTemplateExpression(node) ||
    IsTypeReferenceNode(node) ||
    IsExpressionWithTypeArguments(node) ||
    IsImportTypeNode(node) ||
    IsTypeQueryNode(node) ||
    IsJsxOpeningElement(node) ||
    IsJsxSelfClosingElement(node);
}

function markTypeSubtree(
  source: TargetSourceProgram,
  result: Set<Node>,
  root: Node | undefined,
): void {
  if (root === undefined || result.has(root)) {
    return;
  }
  const pending = [root];
  while (pending.length > 0) {
    const node = pending.pop();
    if (node === undefined || result.has(node)) {
      continue;
    }
    result.add(node);
    for (const child of source.ast.children(node)) {
      if (child !== undefined) {
        pending.push(child);
      }
    }
  }
}
