import {
  fieldFactKey,
  sourceMarkerFactKey,
  structFactKey,
} from "@tsonic/tsts";
import type {
  FieldFact,
  Node,
  SourceFile,
  StructFact,
} from "@tsonic/tsts";
import {
  AsCallExpression,
  AsConstructorDeclaration,
  AsExpressionStatement,
  AsObjectLiteralExpression,
  AsParameterDeclaration,
  AsPropertyAssignment,
  IsBlock,
  IsCallExpression,
  IsClassDeclaration,
  IsConstructorDeclaration,
  IsExportSpecifier,
  IsExpressionStatement,
  IsIdentifier,
  IsImportSpecifier,
  IsNamespaceImport,
  IsObjectLiteralExpression,
  IsPropertyAssignment,
} from "@tsonic/tsts/target-ast";
import type { TargetSourceProgram } from "@tsonic/target-api/source";

import type { TargetProgramIndex } from "../program-index.js";

export interface ValueStructureField {
  readonly declaration: Node;
  readonly name: string;
  readonly type: Node;
}

export interface ValueStructureClass {
  readonly classDeclaration: Node;
  readonly constructorDeclaration: Node;
  readonly assertionStatement: Node;
  readonly structCall: Node;
  readonly sourceFile: SourceFile;
  readonly directLayout: boolean;
  readonly fields: readonly ValueStructureField[];
}

export interface ValueStructurePlan {
  owns(source: TargetSourceProgram): boolean;
  isMarkerNode(node: Node): boolean;
  structureForClass(classDeclaration: Node | undefined): ValueStructureClass | undefined;
  directFieldFor(declaration: Node | undefined): ValueStructureField | undefined;
  assertionForClass(classDeclaration: Node | undefined): Node | undefined;
  assertionsFor(sourceFile: SourceFile): readonly Node[];
  removableDeclarationsFor(sourceFile: SourceFile): readonly Node[];
  readonly assertionCount: number;
  readonly directLayoutCount: number;
}

const noNodes = Object.freeze([]) as readonly Node[];

export function createValueStructurePlan(
  source: TargetSourceProgram,
  program: TargetProgramIndex,
): ValueStructurePlan {
  const structures = new Map<Node, ValueStructureClass>();
  const directFields = new Map<Node, ValueStructureField>();
  const markerNodes = new Set<Node>();
  const assertionByFile = new Map<SourceFile, Node[]>();
  const markerDeclarations = new Set<Node>();
  let directLayoutCount = 0;

  for (const node of program.nodes) {
    const fact = source.sourceFacts.getFact(node, structFactKey);
    if (fact === undefined || !IsCallExpression(node)) {
      continue;
    }
    const structure = readValueStructure(source, node, fact, markerNodes);
    if (structures.has(structure.classDeclaration)) {
      throw new Error("value-structure class has multiple canonical assertions");
    }
    structures.set(structure.classDeclaration, structure);
    append(assertionByFile, structure.sourceFile, structure.assertionStatement);
    collectMarkerDeclaration(source, structure.structCall, markerDeclarations);
    for (const property of structureMarkerProperties(source, structure.structCall)) {
      const initializer = AsPropertyAssignment(property)?.Initializer;
      if (initializer !== undefined) {
        collectMarkerDeclaration(source, initializer, markerDeclarations);
      }
    }
    if (structure.directLayout) {
      directLayoutCount += 1;
      for (const field of structure.fields) {
        if (directFields.has(field.declaration)) {
          throw new Error("value-structure field belongs to multiple layouts");
        }
        directFields.set(field.declaration, field);
      }
    }
  }

  collectStructureMarkerDeclarations(source, program.nodes, markerDeclarations);
  assertNoUnconsumedStructureMarkers(source, program.nodes, markerNodes);
  const removableByFile = removableMarkerDeclarations(
    source,
    markerDeclarations,
    markerNodes,
  );
  const sealedAssertions = sealNodeLists(assertionByFile);
  const assertionCount = [...sealedAssertions.values()].reduce(
    (count, assertions) => count + assertions.length,
    0,
  );
  const sealedRemovable = sealNodeLists(removableByFile);
  return Object.freeze({
    owns(candidate: TargetSourceProgram): boolean {
      return candidate === source;
    },
    isMarkerNode(node: Node): boolean {
      return markerNodes.has(node);
    },
    structureForClass(
      classDeclaration: Node | undefined,
    ): ValueStructureClass | undefined {
      return classDeclaration === undefined
        ? undefined
        : structures.get(classDeclaration);
    },
    directFieldFor(
      declaration: Node | undefined,
    ): ValueStructureField | undefined {
      return declaration === undefined ? undefined : directFields.get(declaration);
    },
    assertionForClass(classDeclaration: Node | undefined): Node | undefined {
      return classDeclaration === undefined
        ? undefined
        : structures.get(classDeclaration)?.assertionStatement;
    },
    assertionsFor(sourceFile: SourceFile): readonly Node[] {
      return sealedAssertions.get(sourceFile) ?? noNodes;
    },
    removableDeclarationsFor(sourceFile: SourceFile): readonly Node[] {
      return sealedRemovable.get(sourceFile) ?? noNodes;
    },
    assertionCount,
    directLayoutCount,
  });
}

function readValueStructure(
  source: TargetSourceProgram,
  structCall: Node,
  fact: StructFact,
  markerNodes: Set<Node>,
): ValueStructureClass {
  const call = AsCallExpression(structCall);
  const statement = source.ast.parent(structCall);
  const expressionStatement = AsExpressionStatement(statement);
  const body = source.ast.parent(statement);
  const constructorDeclaration = source.ast.parent(body);
  const classDeclaration = source.ast.parent(constructorDeclaration);
  const sourceFile = source.ast.getSourceFile(structCall);
  if (
    call === undefined ||
    call.Arguments?.Nodes.length !== 1 ||
    fact.valueType !== true ||
    fact.fields === undefined ||
    statement === undefined ||
    !IsExpressionStatement(statement) ||
    expressionStatement?.Expression !== structCall ||
    body === undefined ||
    !IsBlock(body) ||
    source.ast.statements(body).length !== 1 ||
    source.ast.statements(body)[0] !== statement ||
    constructorDeclaration === undefined ||
    !IsConstructorDeclaration(constructorDeclaration) ||
    AsConstructorDeclaration(constructorDeclaration) === undefined ||
    classDeclaration === undefined ||
    !IsClassDeclaration(classDeclaration) ||
    sourceFile === undefined ||
    source.ast.members(classDeclaration).filter((member) =>
        member !== undefined && IsConstructorDeclaration(member)
      ).length !== 1
  ) {
    throw new Error(
      "struct marker must be the sole statement of one authored class constructor",
    );
  }
  const properties = structureMarkerProperties(source, structCall);
  const fields = readDirectLayoutFields(
    source,
    constructorDeclaration,
    properties,
    fact.fields,
  );
  collectDescendants(source, statement, markerNodes);
  return Object.freeze({
    classDeclaration,
    constructorDeclaration,
    assertionStatement: statement,
    structCall,
    sourceFile,
    directLayout: fields !== undefined,
    fields: fields ?? Object.freeze([]),
  });
}

function structureMarkerProperties(
  source: TargetSourceProgram,
  structCall: Node,
): readonly Node[] {
  const call = AsCallExpression(structCall);
  const shape = call?.Arguments?.Nodes[0];
  const objectLiteral = shape !== undefined && IsObjectLiteralExpression(shape)
    ? AsObjectLiteralExpression(shape)
    : undefined;
  if (objectLiteral === undefined) {
    throw new Error("struct marker requires one exact object-literal shape");
  }
  return Object.freeze(
    (objectLiteral.Properties?.Nodes ?? []).filter(
      (property): property is Node => property !== undefined,
    ),
  );
}

function readDirectLayoutFields(
  source: TargetSourceProgram,
  constructorDeclaration: Node,
  properties: readonly Node[],
  facts: readonly FieldFact[],
): readonly ValueStructureField[] | undefined {
  if (properties.length !== facts.length) {
    throw new Error("struct marker field facts do not exact-join its shape");
  }
  const markerFields = properties.map((property, index) =>
    readMarkerField(source, property, facts[index])
  );
  const declarations = source.ast.parameters(constructorDeclaration).filter(
    (declaration): declaration is Node =>
      declaration !== undefined && source.ast.hasModifierKind(declaration, "public"),
  );
  if (declarations.length !== markerFields.length) {
    return undefined;
  }
  const fields: ValueStructureField[] = [];
  for (let index = 0; index < declarations.length; index += 1) {
    const declaration = declarations[index];
    const parameter = AsParameterDeclaration(declaration);
    const marker = markerFields[index];
    if (
      declaration === undefined ||
      parameter === undefined ||
      marker === undefined ||
      !IsIdentifier(parameter.name) ||
      parameter.Type === undefined ||
      parameter.Initializer !== undefined ||
      parameter.DotDotDotToken !== undefined ||
      parameter.QuestionToken !== undefined ||
      source.ast.hasModifierKind(declaration, "private") ||
      source.ast.hasModifierKind(declaration, "protected") ||
      source.ast.hasModifierKind(declaration, "readonly") ||
      source.ast.text(parameter.name) !== marker.name ||
      !typesAreIdentical(source, parameter.Type, marker.type)
    ) {
      return undefined;
    }
    fields.push(Object.freeze({
      declaration,
      name: marker.name,
      type: marker.type,
    }));
  }
  return Object.freeze(fields);
}

function readMarkerField(
  source: TargetSourceProgram,
  property: Node,
  expected: FieldFact | undefined,
): FieldFact {
  const assignment = IsPropertyAssignment(property)
    ? AsPropertyAssignment(property)
    : undefined;
  const initializer = assignment?.Initializer;
  const fact = initializer === undefined
    ? undefined
    : source.sourceFacts.getFact(initializer, fieldFactKey);
  const name = source.ast.name(property);
  if (
    assignment === undefined ||
    initializer === undefined ||
    !IsCallExpression(initializer) ||
    fact === undefined ||
    expected === undefined ||
    name === undefined ||
    fact.name !== source.ast.text(name) ||
    fact.name !== expected.name ||
    fact.type !== expected.type ||
    fact.readonly !== expected.readonly
  ) {
    throw new Error("struct marker property has no exact field fact");
  }
  return fact;
}

function typesAreIdentical(
  source: TargetSourceProgram,
  leftNode: Node,
  rightNode: Node,
): boolean {
  const semantics = source.semantics.forNode(leftNode);
  const left = semantics.types.authoredType(leftNode);
  const right = semantics.types.authoredType(rightNode);
  return left !== undefined &&
    right !== undefined &&
    semantics.types.relationship(left, right) === "identical";
}

function collectMarkerDeclaration(
  source: TargetSourceProgram,
  call: Node,
  declarations: Set<Node>,
): void {
  const target = AsCallExpression(call)?.Expression;
  const declaration = source.navigation.sourceReferenceFor(target)?.declaration;
  if (
    declaration !== undefined &&
    (IsImportSpecifier(declaration) ||
      IsExportSpecifier(declaration) ||
      IsNamespaceImport(declaration))
  ) {
    declarations.add(declaration);
  }
}

function assertNoUnconsumedStructureMarkers(
  source: TargetSourceProgram,
  nodes: readonly Node[],
  markerNodes: ReadonlySet<Node>,
): void {
  for (const node of nodes) {
    const marker = source.sourceFacts.getFact(node, sourceMarkerFactKey);
    if (
      marker === undefined ||
      marker.kind !== "call-marker" ||
      (marker.marker !== "struct" && marker.marker !== "field") ||
      markerNodes.has(node) ||
      IsImportSpecifier(node) ||
      IsExportSpecifier(node) ||
      IsNamespaceImport(node)
    ) {
      continue;
    }
    throw new Error(
      `selected ${marker.marker} marker is outside a canonical value-structure assertion`,
    );
  }
}

function collectStructureMarkerDeclarations(
  source: TargetSourceProgram,
  nodes: readonly Node[],
  declarations: Set<Node>,
): void {
  for (const node of nodes) {
    const marker = source.sourceFacts.getFact(node, sourceMarkerFactKey);
    if (
      marker?.kind === "call-marker" &&
      (marker.marker === "struct" || marker.marker === "field") &&
      (IsImportSpecifier(node) || IsExportSpecifier(node))
    ) {
      declarations.add(node);
    }
  }
}

function removableMarkerDeclarations(
  source: TargetSourceProgram,
  declarations: ReadonlySet<Node>,
  markerNodes: ReadonlySet<Node>,
): Map<SourceFile, Node[]> {
  const byFile = new Map<SourceFile, Node[]>();
  for (const declaration of declarations) {
    const references = source.navigation.referencesToDeclaration(declaration);
    if (
      IsNamespaceImport(declaration) &&
      references.some((reference) => !markerNodes.has(reference))
    ) {
      continue;
    }
    const sourceFile = source.ast.getSourceFile(declaration);
    if (sourceFile !== undefined) {
      append(byFile, sourceFile, declaration);
    }
  }
  return byFile;
}

function collectDescendants(
  source: TargetSourceProgram,
  root: Node,
  selected: Set<Node>,
): void {
  const pending = [root];
  while (pending.length !== 0) {
    const node = pending.pop();
    if (node === undefined || selected.has(node)) {
      continue;
    }
    selected.add(node);
    for (const child of source.ast.children(node)) {
      if (child !== undefined) {
        pending.push(child);
      }
    }
  }
}

function append(
  target: Map<SourceFile, Node[]>,
  sourceFile: SourceFile,
  node: Node,
): void {
  const selected = target.get(sourceFile);
  if (selected === undefined) {
    target.set(sourceFile, [node]);
  } else {
    selected.push(node);
  }
}

function sealNodeLists(
  source: Map<SourceFile, Node[]>,
): ReadonlyMap<SourceFile, readonly Node[]> {
  return new Map([...source].map(([sourceFile, nodes]) => [
    sourceFile,
    Object.freeze([...nodes]),
  ] as const));
}
