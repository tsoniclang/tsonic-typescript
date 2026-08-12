import type { Node, PointerOperationFact } from "@tsonic/tsts";
import {
  IsDecorator,
} from "@tsonic/tsts/target-ast";
import type { TargetSourceProgram } from "@tsonic/target-api";

import { transparentExpression } from "./flow-syntax.js";
import type { PointerPlanningLedger } from "./planning-ledger.js";

export function nonBijectiveIdentityOccurrences(
  source: TargetSourceProgram,
  familyIdentity: Node,
  operations: Iterable<PointerOperationFact>,
  hasBindingWrite: (declaration: Node | undefined) => boolean,
  ledger: PointerPlanningLedger,
): readonly Node[] {
  const operationsList = [...operations];
  let observesIdentity = false;
  for (const operation of operationsList) {
    ledger.record("direct-family");
    observesIdentity ||= isIdentityObservation(operation);
  }
  if (!observesIdentity) {
    return Object.freeze([]);
  }
  const proof: FreshFamilyProof = {
    activeFactories: new Set(),
    hasBindingWrite,
    factoryResults: new Map(),
    ledger,
  };
  const failures: Node[] = [];
  for (const operation of operationsList) {
    ledger.record("direct-family");
    if (operation.operation === "address-of") {
      failures.push(operation.call);
    } else if (
      operation.operation === "allocate" &&
      !isFreshFamilyConstruction(
        source,
        familyIdentity,
        operation.initialExpression,
        proof,
      )
    ) {
      failures.push(operation.initialExpression);
    }
  }
  return Object.freeze(failures);
}

interface FreshFamilyProof {
  readonly activeFactories: Set<Node>;
  readonly hasBindingWrite: (declaration: Node | undefined) => boolean;
  readonly factoryResults: Map<Node, boolean>;
  readonly ledger: PointerPlanningLedger;
}

function isIdentityObservation(operation: PointerOperationFact): boolean {
  return operation.operation === "equal-pointer" ||
    operation.operation === "hash-pointer";
}

function isFreshFamilyConstruction(
  source: TargetSourceProgram,
  familyIdentity: Node,
  expression: Node,
  proof: FreshFamilyProof,
): boolean {
  return isFreshFamilyValue(
    source,
    familyIdentity,
    expression,
    proof,
  );
}

function isFreshFamilyValue(
  source: TargetSourceProgram,
  familyIdentity: Node,
  expression: Node,
  proof: FreshFamilyProof,
): boolean {
  proof.ledger.record("direct-family");
  const constructionNode = transparentExpression(source, expression);
  if (constructionNode === undefined) {
    return false;
  }
  if (source.ast.is.IsNewExpression(constructionNode)) {
    return isFreshNewExpression(source, familyIdentity, constructionNode, proof);
  }
  return source.ast.is.IsCallExpression(constructionNode) &&
    isFreshFactoryCall(
      source,
      familyIdentity,
      constructionNode,
      proof,
    );
}

function isFreshNewExpression(
  source: TargetSourceProgram,
  familyIdentity: Node,
  constructionNode: Node,
  proof: FreshFamilyProof,
): boolean {
  proof.ledger.record("direct-family");
  if (
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
    !isStableFamily(source, familyIdentity, proof)
  ) {
    return false;
  }
  const members = source.ast.members(familyIdentity);
  const constructors = members.filter((member) => {
    proof.ledger.record("direct-family");
    return member !== undefined && source.ast.is.IsConstructorDeclaration(member);
  });
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
    !containsReplacementReturn(source, body, proof.ledger);
}

function isFreshFactoryCall(
  source: TargetSourceProgram,
  familyIdentity: Node,
  callNode: Node,
  proof: FreshFamilyProof,
): boolean {
  proof.ledger.record("direct-family");
  const call = source.ast.as.AsCallExpression(callNode);
  const target = transparentExpression(source, call?.Expression);
  if (
    target === undefined ||
    !source.ast.is.IsPropertyAccessExpression(target)
  ) {
    return false;
  }
  const property = source.ast.as.AsPropertyAccessExpression(target);
  const receiver = transparentExpression(source, property?.Expression);
  const familyReference = source.navigation.sourceReferenceFor(receiver);
  const methodReference = source.navigation.sourceReferenceFor(target);
  if (
    familyReference === undefined ||
    !familyReference.project ||
    familyReference.declaration !== familyIdentity ||
    methodReference === undefined ||
    !methodReference.project ||
    !source.ast.is.IsMethodDeclaration(methodReference.declaration) ||
    source.ast.parent(methodReference.declaration) !== familyIdentity ||
    !source.ast.hasModifierKind(methodReference.declaration, "static") ||
    source.ast.hasModifierKind(methodReference.declaration, "async") ||
    source.ast.modifiers(methodReference.declaration).some((modifier) =>
      IsDecorator(modifier)
    ) ||
    !isStableFamily(source, familyIdentity, proof) ||
    proof.hasBindingWrite(methodReference.declaration)
  ) {
    return false;
  }
  const method = source.ast.as.AsMethodDeclaration(methodReference.declaration);
  const body = source.ast.body(methodReference.declaration);
  const statements = source.ast.statements(body);
  proof.ledger.record("direct-family");
  const returnStatement = statements.length === 1 && statements[0] !== undefined &&
      source.ast.is.IsReturnStatement(statements[0])
    ? source.ast.as.AsReturnStatement(statements[0])
    : undefined;
  const returned = returnStatement?.Expression;
  const semantics = source.semantics.forNode(callNode);
  const callInfo = semantics.getResolvedCallInfo(callNode);
  if (
    method === undefined ||
    method.AsteriskToken !== undefined ||
    body === undefined ||
    returned === undefined ||
    callInfo?.outcome !== "applicable" ||
    callInfo.sourceSelectedSignatureKind !== "resolved" ||
    callInfo.optionalChain ||
    semantics.getSignatureDeclaration(callInfo.selectedSignature) !==
      methodReference.declaration ||
    proof.activeFactories.has(methodReference.declaration)
  ) {
    return false;
  }
  const cached = proof.factoryResults.get(methodReference.declaration);
  if (cached !== undefined || proof.factoryResults.has(methodReference.declaration)) {
    return cached ?? false;
  }
  proof.activeFactories.add(methodReference.declaration);
  const fresh = isFreshFamilyValue(
    source,
    familyIdentity,
    returned,
    proof,
  );
  proof.activeFactories.delete(methodReference.declaration);
  proof.factoryResults.set(methodReference.declaration, fresh);
  return fresh;
}

function isStableFamily(
  source: TargetSourceProgram,
  familyIdentity: Node,
  proof: FreshFamilyProof,
): boolean {
  proof.ledger.record("direct-family");
  return source.ast.extendsHeritageElements(familyIdentity).length === 0 &&
    !source.ast.modifiers(familyIdentity).some((modifier) => IsDecorator(modifier)) &&
    !proof.hasBindingWrite(familyIdentity);
}

function containsReplacementReturn(
  source: TargetSourceProgram,
  root: Node,
  ledger: PointerPlanningLedger,
): boolean {
  const pending = [root];
  while (pending.length !== 0) {
    ledger.record("direct-family");
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
      ledger.record("direct-family");
      if (child !== undefined) {
        pending.push(child);
      }
    }
  }
  return false;
}
