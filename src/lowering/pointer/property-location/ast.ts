import type { Node, SourceFile } from "@tsonic/tsts";
import {
  AsSourceFile,
  IsImportDeclaration,
  KindEqualsToken,
  KindKeyOfKeyword,
  KindObjectKeyword,
  KindThisKeyword,
  NewBinaryExpression,
  NewBlock,
  NewClassDeclaration,
  NewConstructorDeclaration,
  NewElementAccessExpression,
  NewExpressionStatement,
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
  NewToken,
  NewTypeOperatorNode,
  NewTypeParameterDeclaration,
  NewTypeReferenceNode,
  NodeFactory_NewNodeList,
  NodeFactory_UpdateSourceFile,
} from "@tsonic/tsts/target-ast";
import type { NodeFactory } from "@tsonic/tsts/target-ast";

import { PointerLoweringError } from "../diagnostic.js";
import type { StaticPropertyLocationClassPlan } from "./plan.js";

const objectTypeParameter = "TObject";
const keyTypeParameter = "TKey";
const storageIdentityProperty = "storageIdentity";
const storageKeyProperty = "storageKey";
const valueProperty = "value";

export function lowerStaticPropertyLocation(
  factory: NodeFactory,
  selected: StaticPropertyLocationClassPlan,
  owner: Node,
  key: Node,
): Node {
  return requiredNode(
    NewNewExpression(
      factory,
      identifier(factory, selected.className.text),
      undefined,
      NodeFactory_NewNodeList(factory, [owner, key]),
    ),
    "static property location",
  );
}

export function insertStaticPropertyLocationClasses(
  factory: NodeFactory,
  sourceFile: SourceFile,
  classes: readonly StaticPropertyLocationClassPlan[],
): SourceFile {
  if (classes.length === 0) {
    return sourceFile;
  }
  const statements = [...(sourceFile.Statements?.Nodes ?? [])];
  statements.splice(
    statementInsertionIndex(statements),
    0,
    ...classes.map((selected) => propertyLocationClass(factory, selected)),
  );
  const updated = AsSourceFile(NodeFactory_UpdateSourceFile(
    factory,
    sourceFile,
    NodeFactory_NewNodeList(factory, statements),
    sourceFile.EndOfFileToken,
  ));
  if (updated === undefined) {
    throw new PointerLoweringError(
      "static property-location classes could not be inserted",
    );
  }
  return updated;
}

function propertyLocationClass(
  factory: NodeFactory,
  selected: StaticPropertyLocationClassPlan,
): Node {
  const typeParameters = NodeFactory_NewNodeList(factory, [
    typeParameter(
      factory,
      objectTypeParameter,
      requiredNode(
        NewKeywordTypeNode(factory, KindObjectKeyword),
        "static property-location object constraint",
      ),
    ),
    typeParameter(
      factory,
      keyTypeParameter,
      requiredNode(
        NewTypeOperatorNode(factory, KindKeyOfKeyword, objectType(factory)),
        "static property-location key constraint",
      ),
    ),
  ]);
  return requiredNode(
    NewClassDeclaration(
      factory,
      undefined,
      identifier(factory, selected.className.text),
      typeParameters,
      undefined,
      NodeFactory_NewNodeList(factory, [
        propertyDeclaration(
          factory,
          storageIdentityProperty,
          objectType(factory),
        ),
        propertyDeclaration(factory, storageKeyProperty, keyType(factory)),
        constructorDeclaration(factory),
        getValueDeclaration(factory),
        setValueDeclaration(factory),
      ]),
    ),
    `static property-location class ${selected.propertyName}`,
  );
}

function constructorDeclaration(factory: NodeFactory): Node {
  const parameters = [
    parameter(factory, storageIdentityProperty, objectType(factory)),
    parameter(factory, storageKeyProperty, keyType(factory)),
  ];
  return requiredNode(
    NewConstructorDeclaration(
      factory,
      undefined,
      undefined,
      NodeFactory_NewNodeList(factory, parameters),
      undefined,
      undefined,
      block(factory, [
        assignmentStatement(
          factory,
          thisProperty(factory, storageIdentityProperty),
          identifier(factory, storageIdentityProperty),
        ),
        assignmentStatement(
          factory,
          thisProperty(factory, storageKeyProperty),
          identifier(factory, storageKeyProperty),
        ),
      ]),
    ),
    "static property-location constructor",
  );
}

function getValueDeclaration(factory: NodeFactory): Node {
  return requiredNode(
    NewGetAccessorDeclaration(
      factory,
      undefined,
      identifier(factory, valueProperty),
      undefined,
      NodeFactory_NewNodeList(factory, []),
      indexedValueType(factory),
      undefined,
      block(factory, [
        requiredNode(
          NewReturnStatement(factory, storageValue(factory)),
          "static property-location return",
        ),
      ]),
    ),
    "static property-location getter",
  );
}

function setValueDeclaration(factory: NodeFactory): Node {
  return requiredNode(
    NewSetAccessorDeclaration(
      factory,
      undefined,
      identifier(factory, valueProperty),
      undefined,
      NodeFactory_NewNodeList(factory, [
        parameter(factory, valueProperty, indexedValueType(factory)),
      ]),
      undefined,
      undefined,
      block(factory, [
        assignmentStatement(
          factory,
          storageValue(factory),
          identifier(factory, valueProperty),
        ),
      ]),
    ),
    "static property-location setter",
  );
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
    `static property-location field ${name}`,
  );
}

function typeParameter(factory: NodeFactory, name: string, constraint: Node): Node {
  return requiredNode(
    NewTypeParameterDeclaration(
      factory,
      undefined,
      identifier(factory, name),
      constraint,
      undefined,
      undefined,
    ),
    `static property-location type parameter ${name}`,
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
    `static property-location parameter ${name}`,
  );
}

function objectType(factory: NodeFactory): Node {
  return typeReference(factory, objectTypeParameter);
}

function keyType(factory: NodeFactory): Node {
  return typeReference(factory, keyTypeParameter);
}

function indexedValueType(factory: NodeFactory): Node {
  return requiredNode(
    NewIndexedAccessTypeNode(factory, objectType(factory), keyType(factory)),
    "static property-location indexed value type",
  );
}

function typeReference(factory: NodeFactory, name: string): Node {
  return requiredNode(
    NewTypeReferenceNode(
      factory,
      identifier(factory, name),
      undefined,
    ),
    `static property-location type ${name}`,
  );
}

function storageValue(factory: NodeFactory): Node {
  return requiredNode(
    NewElementAccessExpression(
      factory,
      thisProperty(factory, storageIdentityProperty),
      undefined,
      thisProperty(factory, storageKeyProperty),
      0,
    ),
    "static property-location storage value",
  );
}

function thisProperty(factory: NodeFactory, name: string): Node {
  return requiredNode(
    NewPropertyAccessExpression(
      factory,
      requiredNode(
        NewKeywordExpression(factory, KindThisKeyword),
        "static property-location this expression",
      ),
      undefined,
      identifier(factory, name),
      0,
    ),
    `static property-location this.${name}`,
  );
}

function assignmentStatement(
  factory: NodeFactory,
  left: Node,
  right: Node,
): Node {
  const assignment = requiredNode(
    NewBinaryExpression(
      factory,
      undefined,
      left,
      undefined,
      NewToken(factory, KindEqualsToken),
      right,
    ),
    "static property-location assignment",
  );
  return requiredNode(
    NewExpressionStatement(factory, assignment),
    "static property-location assignment statement",
  );
}

function block(factory: NodeFactory, statements: readonly Node[]): Node {
  return requiredNode(
    NewBlock(factory, NodeFactory_NewNodeList(factory, [...statements]), true),
    "static property-location block",
  );
}

function identifier(factory: NodeFactory, name: string): Node {
  return requiredNode(
    NewIdentifier(factory, name),
    `static property-location identifier ${name}`,
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

function requiredNode(node: Node | undefined, subject: string): Node {
  if (node === undefined) {
    throw new PointerLoweringError(`${subject} was not created`);
  }
  return node;
}
