import {
  structFactKey,
  type Node,
  type PointerOperationFact,
} from "@tsonic/tsts";
import {
  IsDecorator,
} from "@tsonic/tsts/target-ast";
import type { TargetSourceProgram } from "@tsonic/target-api/source";

import type { TargetProgramIndex } from "../program-index.js";
import { addressedStorageIsStable } from "./flow-audit.js";
import { transparentExpression } from "./flow-syntax.js";
import type { PointerPlanningLedger } from "./planning-ledger.js";

export function nonBijectiveIdentityOccurrences(
  source: TargetSourceProgram,
  familyIdentity: Node,
  operations: Iterable<PointerOperationFact>,
  program: TargetProgramIndex,
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
    program,
    factoryResults: new Map(),
    ledger,
  };
  const failures: Node[] = [];
  for (const operation of operationsList) {
    ledger.record("direct-family");
    if (
      operation.operation === "address-of" &&
      !isFreshAddressedStorage(
        source,
        familyIdentity,
        operation,
        proof,
      )
    ) {
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

function isFreshAddressedStorage(
  source: TargetSourceProgram,
  familyIdentity: Node,
  operation: Extract<PointerOperationFact, { readonly operation: "address-of" }>,
  proof: FreshFamilyProof,
): boolean {
  proof.ledger.record("direct-family");
  const declaration = operation.storageDeclaration;
  const variable = declaration === undefined
    ? undefined
    : source.ast.as.AsVariableDeclaration(declaration);
  const initializer = variable?.Initializer;
  return (declaration !== undefined &&
    initializer !== undefined &&
    !proof.program.hasBindingWrite(declaration) &&
    isFreshFamilyValue(source, familyIdentity, initializer, proof)) ||
    isExactValueFieldAddress(source, familyIdentity, operation, proof);
}

function isExactValueFieldAddress(
  source: TargetSourceProgram,
  familyIdentity: Node,
  operation: Extract<PointerOperationFact, { readonly operation: "address-of" }>,
  proof: FreshFamilyProof,
): boolean {
  if (
    source.sourceFacts.getFact(familyIdentity, structFactKey)?.valueType !== true ||
    source.ast.extendsHeritageElements(familyIdentity).length !== 0 ||
    !addressedStorageIsStable(source, proof.program, operation)
  ) {
    return false;
  }
  const storage = transparentExpression(source, operation.storageExpression);
  if (
    storage === undefined ||
    !source.ast.is.IsPropertyAccessExpression(storage)
  ) {
    return false;
  }
  const semantics = source.semantics.forNode(storage);
  const storageType = semantics.types.expressionType(storage);
  const storageSymbol = storageType === undefined
    ? undefined
    : semantics.declarations.typeSymbol(storageType);
  const storageIdentity = storageSymbol === undefined
    ? undefined
    : semantics.declarations.primarySymbolDeclaration(storageSymbol);
  const property = source.ast.as.AsPropertyAccessExpression(storage);
  return storageIdentity === familyIdentity &&
    valueSemanticOwnerPath(source, proof.program, property?.Expression);
}

function valueSemanticOwnerPath(
  source: TargetSourceProgram,
  program: TargetProgramIndex,
  expression: Node | undefined,
): boolean {
  const owner = transparentExpression(source, expression);
  if (owner === undefined) {
    return false;
  }
  const semantics = source.semantics.forNode(owner);
  const ownerType = semantics.types.expressionType(owner);
  const ownerSymbol = ownerType === undefined
    ? undefined
    : semantics.declarations.typeSymbol(ownerType);
  const ownerIdentity = ownerSymbol === undefined
    ? undefined
    : semantics.declarations.primarySymbolDeclaration(ownerSymbol);
  if (
    ownerIdentity === undefined ||
    !source.navigation.isProjectDeclaration(ownerIdentity) ||
    !source.ast.is.IsClassDeclaration(ownerIdentity) ||
    source.sourceFacts.getFact(ownerIdentity, structFactKey)?.valueType !== true ||
    source.ast.extendsHeritageElements(ownerIdentity).length !== 0 ||
    program.hasBindingWrite(ownerIdentity)
  ) {
    return false;
  }
  if (!source.ast.is.IsPropertyAccessExpression(owner)) {
    return source.ast.is.IsIdentifier(owner);
  }
  const property = source.ast.as.AsPropertyAccessExpression(owner);
  return property?.name !== undefined &&
    source.ast.is.IsIdentifier(property.name) &&
    valueSemanticOwnerPath(source, program, property.Expression);
}

interface FreshFamilyProof {
  readonly activeFactories: Set<Node>;
  readonly program: TargetProgramIndex;
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
  const signature = semantics.operations.call(constructionNode)?.selectedSignature;
  return constructor !== undefined &&
    body !== undefined &&
    signature !== undefined &&
    semantics.declarations.signatureDeclaration(signature) === constructor &&
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
  const directReference = source.navigation.sourceReferenceFor(target);
  if (
    target !== undefined &&
    directReference?.project === true &&
    directReference.declaration !== undefined &&
    source.ast.is.IsFunctionDeclaration(directReference.declaration)
  ) {
    return isFreshFactoryDeclaration(
      source,
      familyIdentity,
      callNode,
      directReference.declaration,
      proof,
    );
  }
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
    proof.program.hasBindingWrite(methodReference.declaration)
  ) {
    return false;
  }
  return isFreshFactoryDeclaration(
    source,
    familyIdentity,
    callNode,
    methodReference.declaration,
    proof,
  );
}

function isFreshFactoryDeclaration(
  source: TargetSourceProgram,
  familyIdentity: Node,
  callNode: Node,
  declaration: Node,
  proof: FreshFamilyProof,
): boolean {
  const callable = source.ast.is.IsFunctionDeclaration(declaration)
    ? source.ast.as.AsFunctionDeclaration(declaration)
    : source.ast.is.IsMethodDeclaration(declaration)
    ? source.ast.as.AsMethodDeclaration(declaration)
    : undefined;
  const body = source.ast.body(declaration);
  const statements = source.ast.statements(body);
  proof.ledger.record("direct-family");
  const returnStatement = statements.length === 1 && statements[0] !== undefined &&
      source.ast.is.IsReturnStatement(statements[0])
    ? source.ast.as.AsReturnStatement(statements[0])
    : undefined;
  const returned = returnStatement?.Expression;
  const semantics = source.semantics.forNode(callNode);
  const callInfo = semantics.operations.call(callNode);
  if (
    callable === undefined ||
    callable.AsteriskToken !== undefined ||
    body === undefined ||
    returned === undefined ||
    source.ast.hasModifierKind(declaration, "async") ||
    source.ast.modifiers(declaration).some((modifier) => IsDecorator(modifier)) ||
    proof.program.hasBindingWrite(declaration) ||
    callInfo?.outcome !== "applicable" ||
    callInfo.sourceSelectedSignatureKind !== "resolved" ||
    callInfo.optionalChain ||
    semantics.declarations.signatureDeclaration(callInfo.selectedSignature) !==
      declaration ||
    proof.activeFactories.has(declaration)
  ) {
    return false;
  }
  const cached = proof.factoryResults.get(declaration);
  if (cached !== undefined || proof.factoryResults.has(declaration)) {
    return cached ?? false;
  }
  proof.activeFactories.add(declaration);
  const fresh = isFreshFamilyValue(
    source,
    familyIdentity,
    returned,
    proof,
  );
  proof.activeFactories.delete(declaration);
  proof.factoryResults.set(declaration, fresh);
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
    !proof.program.hasBindingWrite(familyIdentity);
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
