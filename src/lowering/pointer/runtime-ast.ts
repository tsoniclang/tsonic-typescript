import type { Node, SourceFile } from "@tsonic/tsts";
import {
  KindTypeKeyword,
  KindUnknown,
  NewAsExpression,
  NewCallExpression,
  NewIdentifier,
  NewImportClause,
  NewImportDeclaration,
  NewNamespaceImport,
  NewPropertyAccessExpression,
  NewQualifiedName,
  NewStringLiteral,
  NewTypeReferenceNode,
  NodeFactory_NewNodeList,
  NodeFactory_UpdateSourceFile,
} from "@tsonic/tsts/target-ast";
import type { NodeFactory } from "@tsonic/tsts/target-ast";

import { typeScriptRuntimeModule } from "../../runtime/package-contract.js";
import { PointerLoweringError } from "./diagnostic.js";

export function prependRuntimeImport(
  factory: NodeFactory,
  sourceFile: SourceFile,
  runtimeAlias: string,
  usesRuntimeValue: boolean,
): Node {
  const namespace = NewNamespaceImport(
    factory,
    NewIdentifier(factory, runtimeAlias),
  );
  const importClause = NewImportClause(
    factory,
    usesRuntimeValue ? KindUnknown : KindTypeKeyword,
    undefined,
    namespace,
  );
  const declaration = NewImportDeclaration(
    factory,
    undefined,
    importClause,
    NewStringLiteral(factory, typeScriptRuntimeModule, 0),
    undefined,
  );
  const statements = NodeFactory_NewNodeList(factory, [
    requiredRuntimeNode(declaration, "runtime import declaration"),
    ...(sourceFile.Statements?.Nodes ?? []),
  ]);
  return requiredRuntimeNode(
    NodeFactory_UpdateSourceFile(
      factory,
      sourceFile,
      statements,
      sourceFile.EndOfFileToken,
    ),
    "source file with runtime import",
  );
}

export function runtimeType(
  factory: NodeFactory,
  runtimeAlias: string,
  name: string,
  typeArguments: readonly Node[],
): Node {
  const qualifiedName = NewQualifiedName(
    factory,
    NewIdentifier(factory, runtimeAlias),
    NewIdentifier(factory, name),
  );
  return requiredRuntimeNode(
    NewTypeReferenceNode(
      factory,
      qualifiedName,
      NodeFactory_NewNodeList(factory, [...typeArguments]),
    ),
    `runtime type ${name}`,
  );
}

export function runtimeCall(
  factory: NodeFactory,
  runtimeAlias: string,
  name: string,
  typeArguments: readonly Node[],
  arguments_: readonly Node[],
): Node {
  const target = NewPropertyAccessExpression(
    factory,
    NewIdentifier(factory, runtimeAlias),
    undefined,
    NewIdentifier(factory, name),
    0,
  );
  return requiredRuntimeNode(
    NewCallExpression(
      factory,
      target,
      undefined,
      typeArguments.length === 0
        ? undefined
        : NodeFactory_NewNodeList(factory, [...typeArguments]),
      NodeFactory_NewNodeList(factory, [...arguments_]),
      0,
    ),
    `runtime call ${name}`,
  );
}

export function locationValue(
  factory: NodeFactory,
  expression: Node,
  exactLocationType?: Node,
): Node {
  const receiver = exactLocationType === undefined
    ? expression
    : requiredRuntimeNode(
      NewAsExpression(factory, expression, exactLocationType),
      "exact location assertion",
    );
  return requiredRuntimeNode(
    NewPropertyAccessExpression(
      factory,
      receiver,
      undefined,
      NewIdentifier(factory, "value"),
      0,
    ),
    "location value access",
  );
}

function requiredRuntimeNode(
  node: Node | undefined,
  subject: string,
): Node {
  if (node === undefined) {
    throw new PointerLoweringError(`${subject} was not created`);
  }
  return node;
}
