import type { Node, SourceFile } from "@tsonic/tsts";
import {
  AsSourceFile,
  IsImportDeclaration,
  KindEqualsToken,
  KindObjectKeyword,
  KindThisKeyword,
  KindUndefinedKeyword,
  NewBinaryExpression,
  NewBlock,
  NewClassDeclaration,
  NewConstructorDeclaration,
  NewExpressionStatement,
  NewIdentifier,
  NewKeywordExpression,
  NewKeywordTypeNode,
  NewNewExpression,
  NewParameterDeclaration,
  NewPropertyAccessExpression,
  NewPropertyDeclaration,
  NewToken,
  NewTypeParameterDeclaration,
  NewTypeReferenceNode,
  NodeFactory_NewNodeList,
  NodeFactory_UpdateSourceFile,
} from "@tsonic/tsts/target-ast";
import type { NodeFactory } from "@tsonic/tsts/target-ast";

import type { GeneratedBindingName } from "../generated-names.js";
import { PointerLoweringError } from "./diagnostic.js";

const typeParameterName = "T";
const initialParameterName = "initial";
const storageIdentityName = "storageIdentity";
const storageKeyName = "storageKey";
const valueName = "value";

export function rootLocationConstruction(
  factory: NodeFactory,
  className: GeneratedBindingName,
  typeArguments: readonly Node[],
  initial: Node,
): Node {
  return requiredNode(
    NewNewExpression(
      factory,
      identifier(factory, className.text),
      typeArguments.length === 0
        ? undefined
        : NodeFactory_NewNodeList(factory, [...typeArguments]),
      NodeFactory_NewNodeList(factory, [initial]),
    ),
    "root-location construction",
  );
}

export function insertRootLocationClass(
  factory: NodeFactory,
  sourceFile: SourceFile,
  className: GeneratedBindingName,
): SourceFile {
  const statements = [...(sourceFile.Statements?.Nodes ?? [])];
  statements.splice(
    statementInsertionIndex(statements),
    0,
    rootLocationClass(factory, className),
  );
  const updated = AsSourceFile(NodeFactory_UpdateSourceFile(
    factory,
    sourceFile,
    NodeFactory_NewNodeList(factory, statements),
    sourceFile.EndOfFileToken,
  ));
  if (updated === undefined) {
    throw new PointerLoweringError("root-location class could not be inserted");
  }
  return updated;
}

function rootLocationClass(
  factory: NodeFactory,
  className: GeneratedBindingName,
): Node {
  return requiredNode(
    NewClassDeclaration(
      factory,
      undefined,
      identifier(factory, className.text),
      NodeFactory_NewNodeList(factory, [typeParameter(factory)]),
      undefined,
      NodeFactory_NewNodeList(factory, [
        property(factory, storageIdentityName, objectType(factory)),
        property(factory, storageKeyName, undefinedType(factory)),
        property(factory, valueName, valueType(factory)),
        constructor(factory),
      ]),
    ),
    "root-location class",
  );
}

function typeParameter(factory: NodeFactory): Node {
  return requiredNode(
    NewTypeParameterDeclaration(
      factory,
      undefined,
      identifier(factory, typeParameterName),
      undefined,
      undefined,
      undefined,
    ),
    "root-location type parameter",
  );
}

function property(factory: NodeFactory, name: string, type: Node): Node {
  return requiredNode(
    NewPropertyDeclaration(
      factory,
      undefined,
      identifier(factory, name),
      undefined,
      type,
      undefined,
    ),
    `root-location ${name} property`,
  );
}

function constructor(factory: NodeFactory): Node {
  const parameter = requiredNode(
    NewParameterDeclaration(
      factory,
      undefined,
      undefined,
      identifier(factory, initialParameterName),
      undefined,
      valueType(factory),
      undefined,
    ),
    "root-location initial parameter",
  );
  return requiredNode(
    NewConstructorDeclaration(
      factory,
      undefined,
      undefined,
      NodeFactory_NewNodeList(factory, [parameter]),
      undefined,
      undefined,
      requiredNode(
        NewBlock(
          factory,
          NodeFactory_NewNodeList(factory, [
            assignmentStatement(
              factory,
              storageIdentityName,
              thisExpression(factory),
            ),
            assignmentStatement(
              factory,
              storageKeyName,
              undefinedExpression(factory),
            ),
            assignmentStatement(
              factory,
              valueName,
              identifier(factory, initialParameterName),
            ),
          ]),
          true,
        ),
        "root-location constructor body",
      ),
    ),
    "root-location constructor",
  );
}

function assignmentStatement(
  factory: NodeFactory,
  propertyName: string,
  value: Node,
): Node {
  const assignment = requiredNode(
    NewBinaryExpression(
      factory,
      undefined,
      thisProperty(factory, propertyName),
      undefined,
      NewToken(factory, KindEqualsToken),
      value,
    ),
    `root-location ${propertyName} assignment`,
  );
  return requiredNode(
    NewExpressionStatement(factory, assignment),
    `root-location ${propertyName} statement`,
  );
}

function thisProperty(factory: NodeFactory, name: string): Node {
  return requiredNode(
    NewPropertyAccessExpression(
      factory,
      thisExpression(factory),
      undefined,
      identifier(factory, name),
      0,
    ),
    `root-location this.${name}`,
  );
}

function thisExpression(factory: NodeFactory): Node {
  return requiredNode(
    NewKeywordExpression(factory, KindThisKeyword),
    "root-location this expression",
  );
}

function undefinedExpression(factory: NodeFactory): Node {
  return requiredNode(
    NewKeywordExpression(factory, KindUndefinedKeyword),
    "root-location undefined expression",
  );
}

function objectType(factory: NodeFactory): Node {
  return requiredNode(
    NewKeywordTypeNode(factory, KindObjectKeyword),
    "root-location object type",
  );
}

function undefinedType(factory: NodeFactory): Node {
  return requiredNode(
    NewKeywordTypeNode(factory, KindUndefinedKeyword),
    "root-location undefined type",
  );
}

function valueType(factory: NodeFactory): Node {
  return requiredNode(
    NewTypeReferenceNode(
      factory,
      identifier(factory, typeParameterName),
      undefined,
    ),
    "root-location value type",
  );
}

function identifier(factory: NodeFactory, text: string): Node {
  return requiredNode(
    NewIdentifier(factory, text),
    `root-location identifier ${text}`,
  );
}

function statementInsertionIndex(
  statements: readonly (Node | undefined)[],
): number {
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
