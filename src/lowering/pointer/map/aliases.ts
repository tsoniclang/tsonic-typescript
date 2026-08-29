import type { Node } from "@tsonic/tsts";
import {
  AsPropertyAccessExpression,
  AsVariableDeclaration,
  IsVariableDeclaration,
} from "@tsonic/tsts/target-ast";
import type { TargetSourceProgram } from "@tsonic/target-api/source";

export function exactStorageAliasTypeNodes(
  source: TargetSourceProgram,
  classDeclaration: Node,
  storageParameter: Node,
): readonly Node[] | undefined {
  const typeNodes: Node[] = [];
  const visit = (node: Node): void => {
    if (IsVariableDeclaration(node)) {
      const declaration = AsVariableDeclaration(node);
      const initializer = declaration?.Initializer;
      const access = initializer === undefined
        ? undefined
        : AsPropertyAccessExpression(initializer);
      const referenced = access === undefined
        ? undefined
        : source.navigation.sourceReferenceFor(access.name)?.declaration;
      if (referenced === storageParameter && declaration?.Type !== undefined) {
        typeNodes.push(declaration.Type);
      }
    }
    source.ast.forEachChild(node, (child) => {
      if (child !== undefined) {
        visit(child);
      }
    });
  };
  visit(classDeclaration);
  return typeNodes.length === 2 ? Object.freeze(typeNodes) : undefined;
}
