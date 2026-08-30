import type { Node, SourceFile } from "@tsonic/tsts";
import {
  AsClassDeclaration,
  AsConstructorDeclaration,
  AsParameterDeclaration,
  AsPropertyDeclaration,
  IsBlock,
  IsClassStaticBlockDeclaration,
  IsConstructorDeclaration,
  IsDecorator,
  IsGetAccessorDeclaration,
  IsIdentifier,
  IsMethodDeclaration,
  IsPropertyDeclaration,
  IsSetAccessorDeclaration,
} from "@tsonic/tsts/target-ast";
import type { TargetSourceProgram } from "@tsonic/target-api/source";

import type { TargetProgramIndex } from "../program-index.js";
import type {
  GeneratedBindingName,
  ProgramGeneratedNames,
} from "../generated-names.js";

export interface DirectObjectReplacementField {
  readonly declaration: Node;
  readonly name: string;
}

export interface DirectObjectReplacement {
  readonly classDeclaration: Node;
  readonly sourceFile: SourceFile;
  readonly className: string;
  readonly typeParameterNames: readonly string[];
  readonly methodName: GeneratedBindingName;
  readonly fields: readonly DirectObjectReplacementField[];
  readonly storeCalls: readonly Node[];
}

export function planDirectObjectReplacement(
  source: TargetSourceProgram,
  program: TargetProgramIndex,
  generatedNames: ProgramGeneratedNames,
  classDeclaration: Node,
  storeCalls: readonly Node[],
): DirectObjectReplacement | undefined {
  const classNode = AsClassDeclaration(classDeclaration);
  const sourceFile = source.ast.getSourceFile(classDeclaration);
  if (
    classNode?.name === undefined ||
    !IsIdentifier(classNode.name) ||
    sourceFile === undefined ||
    source.ast.isDeclarationFile(sourceFile) ||
    storeCalls.length === 0 ||
    source.ast.extendsHeritageElements(classDeclaration).length !== 0 ||
    source.ast.hasModifierKind(classDeclaration, "abstract") ||
    source.ast.hasModifierKind(classDeclaration, "ambient") ||
    hasDecorator(source, classDeclaration) ||
    program.hasBindingWrite(classDeclaration) ||
    classIsHeritageTarget(source, classDeclaration)
  ) {
    return undefined;
  }
  const members = source.ast.members(classDeclaration);
  const constructors = members.filter((member) =>
    member !== undefined && IsConstructorDeclaration(member)
  );
  const constructorDeclaration = constructors.length === 1
    ? constructors[0]
    : undefined;
  const constructor = AsConstructorDeclaration(constructorDeclaration);
  const body = constructorDeclaration === undefined
    ? undefined
    : source.ast.body(constructorDeclaration);
  if (
    constructorDeclaration === undefined ||
    constructor === undefined ||
    body === undefined ||
    !IsBlock(body) ||
    source.ast.statements(body).length !== 0
  ) {
    return undefined;
  }
  const fields = replacementFields(source, constructorDeclaration);
  if (fields === undefined || !classMembersAreReplaceable(source, members)) {
    return undefined;
  }
  const typeParameterNames = classTypeParameterNames(source, classNode.TypeParameters?.Nodes);
  if (typeParameterNames === undefined) {
    return undefined;
  }
  for (const member of members) {
    if (member === undefined || IsConstructorDeclaration(member)) {
      continue;
    }
    const name = source.ast.name(member);
    if (name === undefined || !IsIdentifier(name)) {
      return undefined;
    }
  }
  return Object.freeze({
    classDeclaration,
    sourceFile,
    className: source.ast.text(classNode.name),
    typeParameterNames,
    methodName: generatedNames.forClass(classDeclaration).reserve(
      "$tsonicReplace",
    ),
    fields,
    storeCalls: Object.freeze([...storeCalls]),
  });
}

function replacementFields(
  source: TargetSourceProgram,
  constructorDeclaration: Node,
): readonly DirectObjectReplacementField[] | undefined {
  const fields: DirectObjectReplacementField[] = [];
  for (const declaration of source.ast.parameters(constructorDeclaration)) {
    const parameter = AsParameterDeclaration(declaration);
    if (
      declaration === undefined ||
      parameter === undefined ||
      !IsIdentifier(parameter.name) ||
      parameter.Type === undefined ||
      parameter.Initializer !== undefined ||
      parameter.DotDotDotToken !== undefined ||
      parameter.QuestionToken !== undefined ||
      !source.ast.hasModifierKind(declaration, "public") ||
      source.ast.hasModifierKind(declaration, "private") ||
      source.ast.hasModifierKind(declaration, "protected") ||
      source.ast.hasModifierKind(declaration, "readonly") ||
      hasDecorator(source, declaration)
    ) {
      return undefined;
    }
    fields.push(Object.freeze({
      declaration,
      name: source.ast.text(parameter.name),
    }));
  }
  return Object.freeze(fields);
}

function classMembersAreReplaceable(
  source: TargetSourceProgram,
  members: readonly (Node | undefined)[],
): boolean {
  for (const member of members) {
    if (member === undefined || hasDecorator(source, member)) {
      return false;
    }
    if (IsConstructorDeclaration(member)) {
      continue;
    }
    if (IsClassStaticBlockDeclaration(member)) {
      return false;
    }
    if (IsPropertyDeclaration(member)) {
      const property = AsPropertyDeclaration(member);
      if (
        property === undefined ||
        property.Initializer !== undefined ||
        !source.ast.hasModifierKind(member, "ambient") ||
        !source.ast.hasModifierKind(member, "readonly")
      ) {
        return false;
      }
      continue;
    }
    if (
      IsGetAccessorDeclaration(member) ||
      IsSetAccessorDeclaration(member) ||
      !IsMethodDeclaration(member)
    ) {
      return false;
    }
  }
  return true;
}

function classTypeParameterNames(
  source: TargetSourceProgram,
  typeParameters: readonly (Node | undefined)[] | undefined,
): readonly string[] | undefined {
  const names: string[] = [];
  for (const parameter of typeParameters ?? []) {
    const name = source.ast.name(parameter);
    if (parameter === undefined || name === undefined || !IsIdentifier(name)) {
      return undefined;
    }
    names.push(source.ast.text(name));
  }
  return Object.freeze(names);
}

function classIsHeritageTarget(
  source: TargetSourceProgram,
  classDeclaration: Node,
): boolean {
  for (const reference of source.navigation.referencesToDeclaration(
    classDeclaration,
  )) {
    let current: Node | undefined = reference;
    let insideHeritage = false;
    while (current !== undefined && !source.ast.is.IsSourceFile(current)) {
      if (source.ast.kindName(current) === "KindHeritageClause") {
        insideHeritage = true;
      }
      if (
        insideHeritage &&
        (source.ast.is.IsClassDeclaration(current) ||
          source.ast.is.IsClassExpression(current) ||
          source.ast.is.IsInterfaceDeclaration(current))
      ) {
        const heritage = source.navigation.declaredHeritage(current);
        if (heritage.kind !== "resolved") {
          return true;
        }
        if (heritage.edges.some((edge) =>
          edge.target.declaration === classDeclaration
        )) {
          return true;
        }
        break;
      }
      current = source.ast.parent(current);
    }
  }
  return false;
}

function hasDecorator(source: TargetSourceProgram, node: Node): boolean {
  return source.ast.modifiers(node).some((modifier) => IsDecorator(modifier));
}
