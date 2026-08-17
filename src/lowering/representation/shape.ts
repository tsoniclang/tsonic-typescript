import type { Node } from "@tsonic/tsts";
import type { TargetSourceProgram } from "@tsonic/target-api";

import type { TargetProgramIndex } from "../program-index.js";
import type { RepresentationProjectionRetentionReason } from "./plan.js";

type ShapeResult =
  | { readonly kind: "unrelated" }
  | {
      readonly kind: "retained";
      readonly reason: RepresentationProjectionRetentionReason;
    }
  | { readonly kind: "proved"; readonly argument: Node };

export interface ProjectionCallShape {
  readonly kind: "proved";
  readonly call: Node;
  readonly declaration: Node;
  readonly parameter: Node;
  readonly storageDeclaration: Node;
}

export function identityCallArgument(
  source: TargetSourceProgram,
  program: TargetProgramIndex,
  callNode: Node,
): ShapeResult {
  const selected = directCallCandidate(source, callNode);
  if (selected === undefined) {
    return { kind: "unrelated" };
  }
  const returned = soleReturnedExpression(source, selected.declaration);
  if (
    returned === undefined ||
    selected.parameters.length !== 1 ||
    !referencesDeclaration(source, returned, selected.parameters[0])
  ) {
    return { kind: "unrelated" };
  }
  if (!selected.exact || selected.argument === undefined) {
    return { kind: "retained", reason: "open-call" };
  }
  if (!stableCallable(source, program, selected.declaration)) {
    return { kind: "retained", reason: "unstable-binding" };
  }
  return { kind: "proved", argument: selected.argument };
}

export function projectionCallShape(
  source: TargetSourceProgram,
  program: TargetProgramIndex,
  callNode: Node,
): ProjectionCallShape | Exclude<ShapeResult, { readonly kind: "proved" }> {
  const selected = directCallCandidate(source, callNode);
  if (selected === undefined || selected.parameters.length !== 1) {
    return { kind: "unrelated" };
  }
  const parameter = selected.parameters[0];
  if (parameter === undefined) {
    throw new Error("exact representation call lost its selected parameter");
  }
  const returned = soleReturnedExpression(source, selected.declaration);
  const property = returned === undefined || !source.ast.is.IsPropertyAccessExpression(returned)
    ? undefined
    : source.ast.as.AsPropertyAccessExpression(returned);
  if (
    property?.Expression === undefined ||
    !referencesDeclaration(source, property.Expression, parameter)
  ) {
    return { kind: "unrelated" };
  }
  const storageDeclaration = source.navigation.sourceReferenceFor(property.name)?.declaration;
  if (storageDeclaration === undefined) {
    return { kind: "retained", reason: "inexact-storage" };
  }
  if (!selected.exact || selected.argument === undefined) {
    return { kind: "retained", reason: "open-call" };
  }
  if (!stableCallable(source, program, selected.declaration)) {
    return { kind: "retained", reason: "unstable-binding" };
  }
  return Object.freeze({
    kind: "proved" as const,
    call: callNode,
    declaration: selected.declaration,
    parameter,
    storageDeclaration,
  });
}

export function inverseProjectionArgument(
  source: TargetSourceProgram,
  program: TargetProgramIndex,
  projection: ProjectionCallShape,
): ShapeResult {
  const outer = source.ast.as.AsCallExpression(projection.call);
  const innerNode = outer?.Arguments?.Nodes[0];
  if (innerNode === undefined || !source.ast.is.IsCallExpression(innerNode)) {
    return { kind: "retained", reason: "unpaired-projection" };
  }
  const factory = directCallCandidate(source, innerNode);
  if (factory === undefined || factory.parameters.length !== 1) {
    return { kind: "retained", reason: "unpaired-projection" };
  }
  if (!factory.exact || factory.argument === undefined) {
    return { kind: "retained", reason: "open-call" };
  }
  if (!stableCallable(source, program, factory.declaration)) {
    return { kind: "retained", reason: "unstable-binding" };
  }
  const returned = soleReturnedExpression(source, factory.declaration);
  if (returned === undefined || !source.ast.is.IsNewExpression(returned)) {
    return { kind: "retained", reason: "unpaired-projection" };
  }
  const construction = source.ast.as.AsNewExpression(returned);
  const constructorArguments = construction?.Arguments?.Nodes ?? [];
  if (
    construction?.Expression === undefined ||
    constructorArguments.length !== 1 ||
    !referencesDeclaration(source, constructorArguments[0], factory.parameters[0])
  ) {
    return { kind: "retained", reason: "unpaired-projection" };
  }
  const classDeclaration = source.navigation.sourceReferenceFor(
    construction.Expression,
  )?.declaration;
  if (
    classDeclaration === undefined ||
    !source.ast.is.IsClassDeclaration(classDeclaration) ||
    !transparentStorageConstructor(
      source,
      program,
      returned,
      classDeclaration,
      projection.storageDeclaration,
    )
  ) {
    return { kind: "retained", reason: "observable-construction" };
  }
  return { kind: "proved", argument: factory.argument };
}

interface DirectCallCandidate {
  readonly declaration: Node;
  readonly parameters: readonly Node[];
  readonly argument?: Node;
  readonly exact: boolean;
}

function directCallCandidate(
  source: TargetSourceProgram,
  callNode: Node,
): DirectCallCandidate | undefined {
  const call = source.ast.as.AsCallExpression(callNode);
  const arguments_ = call?.Arguments?.Nodes ?? [];
  if (
    call?.Expression === undefined
  ) {
    return undefined;
  }
  const targetDeclaration = directTargetDeclaration(source, call.Expression);
  if (targetDeclaration === undefined) {
    return undefined;
  }
  const semantics = source.semantics.forNode(callNode);
  const callInfo = semantics.getResolvedCallInfo(callNode);
  const selectedDeclaration = callInfo?.outcome === "applicable" &&
      callInfo.sourceSelectedSignatureKind === "resolved" &&
      !callInfo.optionalChain
    ? semantics.getSignatureDeclaration(callInfo.selectedSignature)
    : undefined;
  if (
    !source.navigation.isProjectDeclaration(targetDeclaration)
  ) {
    return undefined;
  }
  const parameters = source.ast.parameters(targetDeclaration).filter(
    (parameter): parameter is Node => parameter !== undefined,
  );
  const parameter = parameters[0];
  if (
    parameters.length !== 1 ||
    parameter === undefined ||
    !plainRequiredParameter(source, parameter)
  ) {
    return undefined;
  }
  return Object.freeze({
    declaration: targetDeclaration,
    parameters: Object.freeze([...parameters]),
    ...(arguments_[0] === undefined ? {} : { argument: arguments_[0] }),
    exact: call.QuestionDotToken === undefined &&
      arguments_.length === 1 &&
      arguments_[0] !== undefined &&
      !source.ast.is.IsSpreadElement(arguments_[0]) &&
      selectedDeclaration === targetDeclaration,
  });
}

function directTargetDeclaration(
  source: TargetSourceProgram,
  target: Node,
): Node | undefined {
  if (source.ast.is.IsIdentifier(target)) {
    const declaration = source.navigation.sourceReferenceFor(target)?.declaration;
    return declaration !== undefined && source.ast.is.IsFunctionDeclaration(declaration)
      ? declaration
      : undefined;
  }
  if (!source.ast.is.IsPropertyAccessExpression(target)) {
    return undefined;
  }
  const property = source.ast.as.AsPropertyAccessExpression(target);
  const declaration = source.navigation.sourceReferenceFor(property?.name)?.declaration;
  const parent = source.ast.parent(declaration);
  return property?.Expression !== undefined &&
    declaration !== undefined &&
    source.ast.is.IsMethodDeclaration(declaration) &&
    source.ast.hasModifierKind(declaration, "static") &&
    parent !== undefined &&
    source.ast.is.IsClassDeclaration(parent) &&
    source.navigation.sourceReferenceFor(property.Expression)?.declaration === parent
    ? declaration
    : undefined;
}

function stableCallable(
  source: TargetSourceProgram,
  program: TargetProgramIndex,
  declaration: Node,
): boolean {
  const parsed = source.ast.is.IsFunctionDeclaration(declaration)
    ? source.ast.as.AsFunctionDeclaration(declaration)
    : source.ast.is.IsMethodDeclaration(declaration)
    ? source.ast.as.AsMethodDeclaration(declaration)
    : undefined;
  const parent = source.ast.parent(declaration);
  return parsed !== undefined &&
    parsed.AsteriskToken === undefined &&
    !source.ast.hasModifierKind(declaration, "async") &&
    !source.ast.modifiers(declaration).some((modifier) =>
      source.ast.is.IsDecorator(modifier)
    ) &&
    !program.hasBindingWrite(declaration) &&
    (source.ast.is.IsFunctionDeclaration(declaration) ||
      parent !== undefined &&
        source.ast.is.IsClassDeclaration(parent) &&
        source.ast.extendsHeritageElements(parent).length === 0 &&
        !source.ast.modifiers(parent).some((modifier) =>
          source.ast.is.IsDecorator(modifier)
        ) &&
        !program.hasBindingWrite(parent));
}

function soleReturnedExpression(
  source: TargetSourceProgram,
  declaration: Node,
): Node | undefined {
  const body = source.ast.body(declaration);
  if (body === undefined) {
    return undefined;
  }
  const statements = source.ast.statements(body);
  return statements.length === 1 &&
      statements[0] !== undefined &&
      source.ast.is.IsReturnStatement(statements[0])
    ? source.ast.as.AsReturnStatement(statements[0])?.Expression
    : undefined;
}

function transparentStorageConstructor(
  source: TargetSourceProgram,
  program: TargetProgramIndex,
  construction: Node,
  classDeclaration: Node,
  storageDeclaration: Node,
): boolean {
  const members = source.ast.members(classDeclaration);
  const constructors = members.filter((member) =>
    member !== undefined && source.ast.is.IsConstructorDeclaration(member)
  );
  const constructor = constructors.length === 1 ? constructors[0] : undefined;
  const parameter = constructor === undefined
    ? undefined
    : source.ast.parameters(constructor)[0];
  const parsed = source.ast.as.AsParameterDeclaration(parameter);
  const body = constructor === undefined ? undefined : source.ast.body(constructor);
  const signature = source.semantics.forNode(construction)
    .getResolvedSignature(construction);
  return constructor !== undefined &&
    parameter !== undefined &&
    parameter === storageDeclaration &&
    source.ast.parameters(constructor).length === 1 &&
    parsed !== undefined &&
    parsed.DotDotDotToken === undefined &&
    parsed.QuestionToken === undefined &&
    parsed.Initializer === undefined &&
    isParameterProperty(source, parameter) &&
    body !== undefined &&
    source.ast.statements(body).length === 0 &&
    classMembersAreConstructionTransparent(source, classDeclaration) &&
    classValueReferencesAreClosed(source, classDeclaration) &&
    signature !== undefined &&
    source.semantics.forNode(construction).getSignatureDeclaration(signature) ===
      constructor &&
    !program.hasBindingWrite(classDeclaration) &&
    !program.hasBindingWrite(parameter);
}

function classMembersAreConstructionTransparent(
  source: TargetSourceProgram,
  classDeclaration: Node,
): boolean {
  if (hasDecorator(source, classDeclaration)) {
    return false;
  }
  for (const member of source.ast.members(classDeclaration)) {
    if (member === undefined || hasDecorator(source, member)) {
      return false;
    }
    if (source.ast.is.IsClassStaticBlockDeclaration(member)) {
      return false;
    }
    if (source.ast.is.IsPropertyDeclaration(member)) {
      if (source.ast.as.AsPropertyDeclaration(member)?.Initializer !== undefined) {
        return false;
      }
      continue;
    }
    if (source.ast.is.IsConstructorDeclaration(member)) {
      if (source.ast.parameters(member).some((parameter) =>
        parameter !== undefined && hasDecorator(source, parameter)
      )) {
        return false;
      }
      continue;
    }
    if (
      source.ast.is.IsMethodDeclaration(member) ||
      source.ast.is.IsGetAccessorDeclaration(member) ||
      source.ast.is.IsSetAccessorDeclaration(member) ||
      source.ast.is.IsSemicolonClassElement(member)
    ) {
      continue;
    }
    return false;
  }
  return true;
}

export function classValueReferencesAreClosed(
  source: TargetSourceProgram,
  classDeclaration: Node,
): boolean {
  return source.navigation.referencesToDeclaration(classDeclaration).every((reference) =>
    isModuleForwardingReference(source, reference) ||
    plainTypeReference(source, reference) ||
    exactConstructionTarget(source, reference) ||
    exactStaticCallTarget(source, reference, classDeclaration)
  );
}

function exactConstructionTarget(
  source: TargetSourceProgram,
  reference: Node,
): boolean {
  const parent = source.ast.parent(reference);
  return parent !== undefined &&
    source.ast.is.IsNewExpression(parent) &&
    source.ast.as.AsNewExpression(parent)?.Expression === reference;
}

function exactStaticCallTarget(
  source: TargetSourceProgram,
  reference: Node,
  classDeclaration: Node,
): boolean {
  const access = source.ast.parent(reference);
  if (
    access === undefined ||
    !source.ast.is.IsPropertyAccessExpression(access) ||
    source.ast.as.AsPropertyAccessExpression(access)?.Expression !== reference
  ) {
    return false;
  }
  const call = source.ast.parent(access);
  if (
    call === undefined ||
    !source.ast.is.IsCallExpression(call) ||
    source.ast.as.AsCallExpression(call)?.Expression !== access
  ) {
    return false;
  }
  const member = source.navigation.sourceReferenceFor(
    source.ast.as.AsPropertyAccessExpression(access)?.name,
  )?.declaration;
  return member !== undefined &&
    source.ast.is.IsMethodDeclaration(member) &&
    source.ast.hasModifierKind(member, "static") &&
    source.ast.parent(member) === classDeclaration;
}

function plainTypeReference(
  source: TargetSourceProgram,
  reference: Node,
): boolean {
  let current: Node | undefined = reference;
  while (current !== undefined) {
    if (source.ast.is.IsTypeQueryNode(current)) {
      return false;
    }
    if (source.ast.is.IsTypeReferenceNode(current)) {
      return true;
    }
    current = source.ast.parent(current);
  }
  return false;
}

function isModuleForwardingReference(
  source: TargetSourceProgram,
  reference: Node,
): boolean {
  let current: Node | undefined = reference;
  while (current !== undefined) {
    if (
      source.ast.is.IsImportSpecifier(current) ||
      source.ast.is.IsExportSpecifier(current)
    ) {
      return true;
    }
    if (
      !source.ast.is.IsNamedImports(current) &&
      !source.ast.is.IsNamedExports(current)
    ) {
      return false;
    }
    current = source.ast.parent(current);
  }
  return false;
}

function hasDecorator(source: TargetSourceProgram, node: Node): boolean {
  return source.ast.modifiers(node).some((modifier) =>
    source.ast.is.IsDecorator(modifier)
  );
}

function isParameterProperty(
  source: TargetSourceProgram,
  parameter: Node,
): boolean {
  return (["public", "private", "protected", "readonly"] as const).some((modifier) =>
    source.ast.hasModifierKind(parameter, modifier)
  );
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

function referencesDeclaration(
  source: TargetSourceProgram,
  expression: Node | undefined,
  declaration: Node | undefined,
): boolean {
  return expression !== undefined &&
    declaration !== undefined &&
    source.ast.is.IsIdentifier(expression) &&
    source.navigation.sourceReferenceFor(expression)?.declaration === declaration;
}
