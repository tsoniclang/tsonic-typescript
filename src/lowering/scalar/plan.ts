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
  AsTypeAliasDeclaration,
  AsTypeReferenceNode,
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

export type ScalarPrimitiveKind =
  | "bigint"
  | "boolean"
  | "number"
  | "string";

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
  readonly resultTypeNode: Node;
  readonly portableResultType?: ScalarPrimitiveKind;
}

const noProjections = Object.freeze([]) as readonly ScalarProjectionPlan[];

export function createScalarRepresentationPlan(
  source: TargetSourceProgram,
  profile: ScalarRepresentationProfile,
): ScalarRepresentationPlan {
  if (profile !== "preserve" && profile !== "closed-direct") {
    throw new Error(`unsupported scalar representation profile '${String(profile)}'`);
  }
  let syntacticProjectionCount = 0;
  const classProofs = new Map<Node, TransparentClassProof | undefined>();
  const portableScalarKinds = new Map<Node, ScalarPrimitiveKind | undefined>();
  const projections: ScalarProjectionPlan[] = [];
  forEachProgramNode(source, (node) => {
    if (!isSyntacticProjection(node)) {
      return;
    }
    syntacticProjectionCount += 1;
    if (profile === "closed-direct") {
      const projection = resolveProjection(
        source,
        node,
        classProofs,
        portableScalarKinds,
      );
      if (projection !== undefined) {
        projections.push(projection);
      }
    }
  });
  return sealPlan(
    source,
    profile,
    syntacticProjectionCount,
    projections,
  );
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

function forEachProgramNode(
  source: TargetSourceProgram,
  visit: (node: Node) => void,
): void {
  for (const sourceFile of source.sourceFiles) {
    const pending: Node[] = [sourceFile];
    while (pending.length > 0) {
      const node = pending.pop();
      if (node === undefined) {
        continue;
      }
      visit(node);
      const children = source.ast.children(node);
      for (let index = children.length - 1; index >= 0; index -= 1) {
        const child = children[index];
        if (child !== undefined) {
          pending.push(child);
        }
      }
    }
  }
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
  portableScalarKinds: Map<Node, ScalarPrimitiveKind | undefined>,
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
    !IsClassDeclaration(reference.declaration)
  ) {
    return undefined;
  }
  const classDeclaration = reference.declaration;
  const classSourceFile = source.ast.getSourceFile(classDeclaration);
  const useSourceFile = source.ast.getSourceFile(node);
  if (classSourceFile === undefined || useSourceFile === undefined) {
    return undefined;
  }
  const sameSourceFile = classSourceFile === useSourceFile;
  let classProof = classProofs.get(classDeclaration);
  if (!classProofs.has(classDeclaration)) {
    classProof = proveTransparentClass(
      source,
      classDeclaration,
      portableScalarKinds,
    );
    classProofs.set(classDeclaration, classProof);
  }
  if (classProof === undefined) {
    return undefined;
  }
  let resultType: ScalarProjectionResultType;
  if (sameSourceFile) {
    resultType = Object.freeze({
      kind: "authored",
      node: classProof.resultTypeNode,
    });
  } else {
    const portable = classProof.portableResultType;
    if (portable === undefined) {
      return undefined;
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
    resultType,
  });
}

function proveTransparentClass(
  source: TargetSourceProgram,
  declaration: Node,
  portableScalarKinds: Map<Node, ScalarPrimitiveKind | undefined>,
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
  const classReference = source.navigation.sourceReferenceFor(
    classDeclaration.name,
  );
  if (
    classReference === undefined ||
    !classReference.project ||
    classReference.declaration !== declaration ||
    source.navigation.bindingWritesWithin(
      classReference.symbol,
      classReference.sourceFile,
    ).length !== 0
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
  const scalarKind = scalarPrimitiveKind(
    semantics,
    selectedParameter.selectedType,
  );
  if (scalarKind === undefined) {
    return undefined;
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
    constructorDeclaration,
    parameterDeclaration,
    resultTypeNode: parameter.Type,
    ...(portableResultType === undefined ? {} : { portableResultType }),
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

function scalarPrimitiveKind(
  semantics: ReturnType<TargetSourceProgram["semantics"]["forNode"]>,
  type: Type,
): ScalarPrimitiveKind | undefined {
  if (semantics.isNumberLike(type)) {
    return "number";
  }
  if (semantics.isStringLike(type)) {
    return "string";
  }
  if (semantics.isBooleanLike(type)) {
    return "boolean";
  }
  return semantics.isBigIntLike(type) ? "bigint" : undefined;
}

function portableScalarKind(
  source: TargetSourceProgram,
  authoredType: Node,
  knownKinds: Map<Node, ScalarPrimitiveKind | undefined>,
): ScalarPrimitiveKind | undefined {
  if (knownKinds.has(authoredType)) {
    return knownKinds.get(authoredType);
  }
  const visited = new Set<Node>();
  const path: Node[] = [];
  let current: Node | undefined = authoredType;
  let result: ScalarPrimitiveKind | undefined;
  while (current !== undefined) {
    if (knownKinds.has(current)) {
      result = knownKinds.get(current);
      break;
    }
    if (visited.has(current)) {
      break;
    }
    visited.add(current);
    path.push(current);
    if (source.ast.is.IsParenthesizedTypeNode(current)) {
      current = source.ast.as.AsParenthesizedTypeNode(current)?.Type;
      continue;
    }
    const keyword = primitiveKindName(source.ast.kindName(current));
    if (keyword !== undefined) {
      result = keyword;
      break;
    }
    const reference = AsTypeReferenceNode(current);
    if (
      reference === undefined ||
      (reference.TypeArguments?.Nodes.length ?? 0) !== 0
    ) {
      break;
    }
    const declaration = source.navigation.sourceReferenceFor(
      reference.TypeName,
    )?.declaration;
    if (declaration === undefined) {
      break;
    }
    const alias = AsTypeAliasDeclaration(declaration);
    if (
      alias?.Type === undefined ||
      source.ast.typeParameters(declaration).length !== 0
    ) {
      break;
    }
    current = alias.Type;
  }
  for (const node of path) {
    knownKinds.set(node, result);
  }
  return result;
}

function primitiveKindName(
  kind: string | undefined,
): ScalarPrimitiveKind | undefined {
  switch (kind) {
    case "KindBigIntKeyword":
      return "bigint";
    case "KindBooleanKeyword":
      return "boolean";
    case "KindNumberKeyword":
      return "number";
    case "KindStringKeyword":
      return "string";
    default:
      return undefined;
  }
}

function hasDecorator(source: TargetSourceProgram, node: Node): boolean {
  return source.ast.modifiers(node).some((modifier) => IsDecorator(modifier));
}
