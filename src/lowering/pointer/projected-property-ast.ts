import type { Node, SourceFile } from "@tsonic/tsts";
import type { TargetSourceProgram } from "@tsonic/target-api/source";
import {
  AsCallExpression,
  AsElementAccessExpression,
  AsPropertyAccessExpression,
  AsSourceFile,
  IsCallExpression,
  IsElementAccessExpression,
  IsImportDeclaration,
  IsPropertyAccessExpression,
  KindEqualsToken,
  KindKeyOfKeyword,
  KindObjectKeyword,
  KindThisKeyword,
  NewBinaryExpression,
  NewBlock,
  NewCallExpression,
  NewClassDeclaration,
  NewConstructorDeclaration,
  NewElementAccessExpression,
  NewExpressionStatement,
  NewFunctionTypeNode,
  NewGetAccessorDeclaration,
  NewIdentifier,
  NewIndexedAccessTypeNode,
  NewKeywordExpression,
  NewKeywordTypeNode,
  NewNewExpression,
  NewParameterDeclaration,
  NewPropertyAccessExpression,
  NewPropertyDeclaration,
  NewReturnStatement,
  NewSetAccessorDeclaration,
  NewStringLiteral,
  NewToken,
  NewTypeOperatorNode,
  NewTypeParameterDeclaration,
  NewTypeReferenceNode,
  NodeFactory_NewNodeList,
  NodeFactory_UpdateSourceFile,
} from "@tsonic/tsts/target-ast";
import type { NodeFactory } from "@tsonic/tsts/target-ast";

import type { FinalNodeLookup } from "../final-nodes.js";
import type { GeneratedBindingName } from "../generated-names.js";

import { PointerLoweringError } from "./diagnostic.js";
import { loweredProjectionArguments } from "./location-operation-ast.js";
import type { PointerLoweringPlan } from "./plan.js";
import type { ProjectedPropertyLocationFusion } from "./projected-property.js";

const objectTypeParameter = "TObject";
const keyTypeParameter = "TKey";
const targetTypeParameter = "TTarget";
const storageIdentityProperty = "storageIdentity";
const storageKeyProperty = "storageKey";
const fromSourceProperty = "fromSource";
const toSourceProperty = "toSource";
const valueProperty = "value";

export function lowerProjectedPropertyLocation(
  source: TargetSourceProgram,
  factory: NodeFactory,
  fusion: ProjectedPropertyLocationFusion,
  updated: Node,
  plan: PointerLoweringPlan,
  finalNodes: FinalNodeLookup,
): Node {
  const helperName = plan.projectedPropertyLocationClassName;
  if (helperName === undefined) {
    throw new PointerLoweringError(
      "projected-property fusion has no collision-safe class name",
    );
  }
  const call = IsCallExpression(updated) ? AsCallExpression(updated) : undefined;
  if (call === undefined) {
    throw new PointerLoweringError(
      "projected-property fusion lost its exact call expression",
    );
  }
  const projectionArguments = loweredProjectionArguments(
    requireNodes(
      call.Arguments?.Nodes ?? [],
      "projected-property arguments",
    ),
    fusion.projection,
    plan,
    finalNodes,
  );
  if (projectionArguments.length !== 3) {
    throw new PointerLoweringError(
      `projected-property fusion requires three arguments, got ${projectionArguments.length}`,
    );
  }
  const storage = requiredFinalNode(
    finalNodes,
    fusion.address.storageExpression,
    "projected-property storage",
  );
  const { owner, key } = storageOwnerAndKey(
    source,
    factory,
    fusion,
    storage,
  );
  return requiredNode(
    NewNewExpression(
      factory,
      identifier(factory, helperName.text),
      undefined,
      NodeFactory_NewNodeList(factory, [
        owner,
        key,
        requiredElement(projectionArguments, 1),
        requiredElement(projectionArguments, 2),
      ]),
    ),
    "projected-property location",
  );
}

export function insertProjectedPropertyLocationClass(
  factory: NodeFactory,
  sourceFile: SourceFile,
  className: GeneratedBindingName,
): SourceFile {
  const statements = [...(sourceFile.Statements?.Nodes ?? [])];
  const insertionIndex = statementInsertionIndex(statements);
  statements.splice(
    insertionIndex,
    0,
    projectedPropertyLocationClass(factory, className),
  );
  const updated = AsSourceFile(NodeFactory_UpdateSourceFile(
    factory,
    sourceFile,
    NodeFactory_NewNodeList(factory, statements),
    sourceFile.EndOfFileToken,
  ));
  if (updated === undefined) {
    throw new PointerLoweringError(
      "projected-property class could not be inserted",
    );
  }
  return updated;
}

function projectedPropertyLocationClass(
  factory: NodeFactory,
  className: GeneratedBindingName,
): Node {
  const typeParameters = NodeFactory_NewNodeList(factory, [
    typeParameter(
      factory,
      objectTypeParameter,
      requiredNode(
        NewKeywordTypeNode(factory, KindObjectKeyword),
        "projected-property object constraint",
      ),
    ),
    typeParameter(
      factory,
      keyTypeParameter,
      requiredNode(
        NewTypeOperatorNode(
          factory,
          KindKeyOfKeyword,
          objectType(factory),
        ),
        "projected-property key constraint",
      ),
    ),
    typeParameter(factory, targetTypeParameter),
  ]);
  const members = [
    propertyDeclaration(factory, storageIdentityProperty, objectType(factory)),
    propertyDeclaration(factory, storageKeyProperty, keyType(factory)),
    propertyDeclaration(
      factory,
      fromSourceProperty,
      functionType(factory, sourceValueType(factory), targetType(factory)),
    ),
    propertyDeclaration(
      factory,
      toSourceProperty,
      functionType(factory, targetType(factory), sourceValueType(factory)),
    ),
    constructorDeclaration(factory),
    getValueDeclaration(factory),
    setValueDeclaration(factory),
  ];
  return requiredNode(
    NewClassDeclaration(
      factory,
      undefined,
      identifier(factory, className.text),
      typeParameters,
      undefined,
      NodeFactory_NewNodeList(factory, members),
    ),
    "projected-property class",
  );
}

function constructorDeclaration(factory: NodeFactory): Node {
  const parameters = [
    parameter(factory, storageIdentityProperty, objectType(factory)),
    parameter(factory, storageKeyProperty, keyType(factory)),
    parameter(
      factory,
      fromSourceProperty,
      functionType(factory, sourceValueType(factory), targetType(factory)),
    ),
    parameter(
      factory,
      toSourceProperty,
      functionType(factory, targetType(factory), sourceValueType(factory)),
    ),
  ];
  const assignments = parameters.map((parameterNode, index) => {
    const name = [
      storageIdentityProperty,
      storageKeyProperty,
      fromSourceProperty,
      toSourceProperty,
    ][index];
    if (name === undefined || parameterNode === undefined) {
      throw new PointerLoweringError(
        "projected-property constructor parameter ordering is incomplete",
      );
    }
    return expressionStatement(
      factory,
      assignment(
        factory,
        thisProperty(factory, name),
        identifier(factory, name),
      ),
      `projected-property constructor assignment ${name}`,
    );
  });
  return requiredNode(
    NewConstructorDeclaration(
      factory,
      undefined,
      undefined,
      NodeFactory_NewNodeList(factory, parameters),
      undefined,
      undefined,
      block(factory, assignments, "projected-property constructor body"),
    ),
    "projected-property constructor",
  );
}

function getValueDeclaration(factory: NodeFactory): Node {
  const sourceValue = elementAccess(
    factory,
    thisProperty(factory, storageIdentityProperty),
    thisProperty(factory, storageKeyProperty),
  );
  const converted = call(
    factory,
    thisProperty(factory, fromSourceProperty),
    [sourceValue],
  );
  return requiredNode(
    NewGetAccessorDeclaration(
      factory,
      undefined,
      identifier(factory, valueProperty),
      undefined,
      NodeFactory_NewNodeList(factory, []),
      targetType(factory),
      undefined,
      block(
        factory,
        [requiredNode(NewReturnStatement(factory, converted), "projected-property return")],
        "projected-property getter body",
      ),
    ),
    "projected-property getter",
  );
}

function setValueDeclaration(factory: NodeFactory): Node {
  const target = elementAccess(
    factory,
    thisProperty(factory, storageIdentityProperty),
    thisProperty(factory, storageKeyProperty),
  );
  const converted = call(
    factory,
    thisProperty(factory, toSourceProperty),
    [identifier(factory, valueProperty)],
  );
  return requiredNode(
    NewSetAccessorDeclaration(
      factory,
      undefined,
      identifier(factory, valueProperty),
      undefined,
      NodeFactory_NewNodeList(factory, [
        parameter(factory, valueProperty, targetType(factory)),
      ]),
      undefined,
      undefined,
      block(
        factory,
        [expressionStatement(
          factory,
          assignment(factory, target, converted),
          "projected-property setter assignment",
        )],
        "projected-property setter body",
      ),
    ),
    "projected-property setter",
  );
}

function storageOwnerAndKey(
  source: TargetSourceProgram,
  factory: NodeFactory,
  fusion: ProjectedPropertyLocationFusion,
  storage: Node,
): { readonly owner: Node; readonly key: Node } {
  const original = fusion.address.storageExpression;
  const property = IsPropertyAccessExpression(storage)
    ? AsPropertyAccessExpression(storage)
    : undefined;
  if (property !== undefined) {
    const originalProperty = source.ast.as.AsPropertyAccessExpression(original);
    if (
      !source.ast.is.IsPropertyAccessExpression(original) ||
      originalProperty?.name === undefined ||
      property.Expression === undefined
    ) {
      throw new PointerLoweringError(
        "projected-property fusion lost its exact property storage",
      );
    }
    return Object.freeze({
      owner: property.Expression,
      key: requiredNode(
        NewStringLiteral(factory, source.ast.text(originalProperty.name), 0),
        "projected-property name",
      ),
    });
  }
  const element = IsElementAccessExpression(storage)
    ? AsElementAccessExpression(storage)
    : undefined;
  if (element !== undefined) {
    if (
      !source.ast.is.IsElementAccessExpression(original) ||
      element.Expression === undefined ||
      element.ArgumentExpression === undefined
    ) {
      throw new PointerLoweringError(
        "projected-property fusion lost its exact element storage",
      );
    }
    return Object.freeze({
      owner: element.Expression,
      key: element.ArgumentExpression,
    });
  }
  throw new PointerLoweringError(
    "projected-property fusion received non-property storage",
  );
}

function statementInsertionIndex(statements: readonly (Node | undefined)[]): number {
  let insertionIndex = 0;
  for (let index = 0; index < statements.length; index += 1) {
    if (IsImportDeclaration(statements[index])) {
      insertionIndex = index + 1;
    }
  }
  return insertionIndex;
}

function propertyDeclaration(
  factory: NodeFactory,
  name: string,
  type: Node,
): Node {
  return requiredNode(
    NewPropertyDeclaration(
      factory,
      undefined,
      identifier(factory, name),
      undefined,
      type,
      undefined,
    ),
    `projected-property field ${name}`,
  );
}

function typeParameter(factory: NodeFactory, name: string, constraint?: Node): Node {
  return requiredNode(
    NewTypeParameterDeclaration(
      factory,
      undefined,
      identifier(factory, name),
      constraint,
      undefined,
      undefined,
    ),
    `projected-property type parameter ${name}`,
  );
}

function functionType(factory: NodeFactory, input: Node, output: Node): Node {
  return requiredNode(
    NewFunctionTypeNode(
      factory,
      undefined,
      NodeFactory_NewNodeList(factory, [parameter(factory, valueProperty, input)]),
      output,
    ),
    "projected-property converter type",
  );
}

function parameter(factory: NodeFactory, name: string, type: Node): Node {
  return requiredNode(
    NewParameterDeclaration(
      factory,
      undefined,
      undefined,
      identifier(factory, name),
      undefined,
      type,
      undefined,
    ),
    `projected-property parameter ${name}`,
  );
}

function typeReference(factory: NodeFactory, name: string): Node {
  return requiredNode(
    NewTypeReferenceNode(factory, identifier(factory, name), undefined),
    `projected-property type ${name}`,
  );
}

function objectType(factory: NodeFactory): Node {
  return typeReference(factory, objectTypeParameter);
}

function keyType(factory: NodeFactory): Node {
  return typeReference(factory, keyTypeParameter);
}

function targetType(factory: NodeFactory): Node {
  return typeReference(factory, targetTypeParameter);
}

function sourceValueType(factory: NodeFactory): Node {
  return requiredNode(
    NewIndexedAccessTypeNode(
      factory,
      objectType(factory),
      keyType(factory),
    ),
    "projected-property source value type",
  );
}

function thisProperty(factory: NodeFactory, name: string): Node {
  return requiredNode(
    NewPropertyAccessExpression(
      factory,
      requiredNode(
        NewKeywordExpression(factory, KindThisKeyword),
        "projected-property this expression",
      ),
      undefined,
      identifier(factory, name),
      0,
    ),
    `projected-property this.${name}`,
  );
}

function elementAccess(factory: NodeFactory, owner: Node, key: Node): Node {
  return requiredNode(
    NewElementAccessExpression(factory, owner, undefined, key, 0),
    "projected-property element access",
  );
}

function assignment(factory: NodeFactory, left: Node, right: Node): Node {
  return requiredNode(
    NewBinaryExpression(
      factory,
      undefined,
      left,
      undefined,
      NewToken(factory, KindEqualsToken),
      right,
    ),
    "projected-property assignment",
  );
}

function expressionStatement(
  factory: NodeFactory,
  expression: Node,
  subject: string,
): Node {
  return requiredNode(NewExpressionStatement(factory, expression), subject);
}

function call(factory: NodeFactory, target: Node, arguments_: readonly Node[]): Node {
  return requiredNode(
    NewCallExpression(
      factory,
      target,
      undefined,
      undefined,
      NodeFactory_NewNodeList(factory, [...arguments_]),
      0,
    ),
    "projected-property converter call",
  );
}

function block(
  factory: NodeFactory,
  statements: readonly Node[],
  subject: string,
): Node {
  return requiredNode(
    NewBlock(factory, NodeFactory_NewNodeList(factory, [...statements]), true),
    subject,
  );
}

function identifier(factory: NodeFactory, text: string): Node {
  return requiredNode(
    NewIdentifier(factory, text),
    `projected-property identifier ${text}`,
  );
}

function requiredFinalNode(
  finalNodes: FinalNodeLookup,
  original: Node,
  subject: string,
): Node {
  return requiredNode(finalNodes.forOriginal(original), subject);
}

function requiredElement(values: readonly Node[], index: number): Node {
  const value = values[index];
  if (value === undefined) {
    throw new PointerLoweringError(
      `projected-property fusion lost argument ${index}`,
    );
  }
  return value;
}

function requireNodes(
  values: readonly (Node | undefined)[],
  subject: string,
): readonly Node[] {
  const nodes: Node[] = [];
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index];
    if (value === undefined) {
      throw new PointerLoweringError(
        `${subject} contains an absent node at index ${index}`,
      );
    }
    nodes.push(value);
  }
  return nodes;
}

function requiredNode(node: Node | undefined, subject: string): Node {
  if (node === undefined) {
    throw new PointerLoweringError(`${subject} was not created`);
  }
  return node;
}
