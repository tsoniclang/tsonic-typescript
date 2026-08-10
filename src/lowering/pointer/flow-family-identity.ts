import type { Node, PointerOperationFact, Symbol } from "@tsonic/tsts";
import {
  IsDecorator,
} from "@tsonic/tsts/target-ast";
import type { TargetSourceProgram } from "@tsonic/target-api";

import { transparentExpression } from "./flow-syntax.js";

export function nonBijectiveIdentityOccurrences(
  source: TargetSourceProgram,
  familyIdentity: Node,
  operations: Iterable<PointerOperationFact>,
): readonly Node[] {
  const operationsList = [...operations];
  if (!operationsList.some(isIdentityObservation)) {
    return Object.freeze([]);
  }
  const failures: Node[] = [];
  for (const operation of operationsList) {
    if (operation.operation === "address-of") {
      failures.push(operation.call);
    } else if (
      operation.operation === "allocate" &&
      !isFreshFamilyConstruction(
        source,
        familyIdentity,
        operation.initialExpression,
      )
    ) {
      failures.push(operation.initialExpression);
    }
  }
  return Object.freeze(failures);
}

function isIdentityObservation(operation: PointerOperationFact): boolean {
  return operation.operation === "equal-pointer" ||
    operation.operation === "hash-pointer";
}

function isFreshFamilyConstruction(
  source: TargetSourceProgram,
  familyIdentity: Node,
  expression: Node,
): boolean {
  const constructionNode = transparentExpression(source, expression);
  if (
    constructionNode === undefined ||
    !source.ast.is.IsNewExpression(constructionNode)
  ) {
    return false;
  }
  const construction = source.ast.as.AsNewExpression(constructionNode);
  const target = transparentExpression(source, construction?.Expression);
  const reference = source.navigation.sourceReferenceFor(target);
  if (
    reference === undefined ||
    !reference.project ||
    reference.declaration !== familyIdentity ||
    source.ast.extendsHeritageElements(familyIdentity).length !== 0 ||
    source.ast.modifiers(familyIdentity).some((modifier) => IsDecorator(modifier)) ||
    classBindingCanChange(source, reference.symbol)
  ) {
    return false;
  }
  const constructors = source.ast.members(familyIdentity).filter((member) =>
    member !== undefined && source.ast.is.IsConstructorDeclaration(member)
  );
  if (constructors.length === 0) {
    return true;
  }
  const constructor = constructors.length === 1 ? constructors[0] : undefined;
  const body = constructor === undefined ? undefined : source.ast.body(constructor);
  const semantics = source.semantics.forNode(constructionNode);
  const signature = semantics.getResolvedSignature(constructionNode);
  return constructor !== undefined &&
    body !== undefined &&
    signature !== undefined &&
    semantics.getSignatureDeclaration(signature) === constructor &&
    !containsReplacementReturn(source, body);
}

function classBindingCanChange(
  source: TargetSourceProgram,
  symbol: Symbol,
): boolean {
  return source.navigation.sourceFiles.some((sourceFile) =>
    source.navigation.bindingWritesWithin(symbol, sourceFile).length !== 0
  );
}

function containsReplacementReturn(
  source: TargetSourceProgram,
  root: Node,
): boolean {
  const pending = [root];
  while (pending.length !== 0) {
    const node = pending.pop();
    if (node === undefined) {
      continue;
    }
    if (
      source.ast.is.IsReturnStatement(node) &&
      source.ast.as.AsReturnStatement(node)?.Expression !== undefined
    ) {
      return true;
    }
    for (const child of source.ast.children(node)) {
      if (child !== undefined) {
        pending.push(child);
      }
    }
  }
  return false;
}
