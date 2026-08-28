import type { Node, PointerOperationFact, SourceFile } from "@tsonic/tsts";
import {
  AsPropertyAccessExpression,
  AsVariableDeclaration,
  IsIdentifier,
  IsPropertyAccessExpression,
  IsVariableDeclaration,
  NewIndexedAccessTypeNode,
  NewLiteralTypeNode,
  NewStringLiteral,
  NodeFactory_UpdateVariableDeclaration,
} from "@tsonic/tsts/target-ast";
import type { NodeFactory } from "@tsonic/tsts/target-ast";
import type { TargetSourceProgram } from "@tsonic/target-api/source";

import type { FinalNodeLookup } from "../final-nodes.js";
import type { ClosedPointerFlowPlan } from "./flow-plan.js";
import { PointerLoweringError } from "./diagnostic.js";

export interface PointerInferenceStabilization {
  readonly declaration: Node;
  readonly pointeeTypeNode: Node;
  readonly propertyName: string;
}

export function planPointerInferenceStabilizations(
  source: TargetSourceProgram,
  sourceFile: SourceFile,
  operations: ReadonlyMap<Node, PointerOperationFact>,
  flowPlan: ClosedPointerFlowPlan | undefined,
): ReadonlyMap<Node, PointerInferenceStabilization> {
  const stabilizations = new Map<Node, PointerInferenceStabilization>();
  if (flowPlan === undefined) {
    return stabilizations;
  }
  for (const operation of operations.values()) {
    if (
      operation.operation !== "load" ||
      flowPlan.representationFor(operation.call) !== "mutable-cell"
    ) {
      continue;
    }
    const pointeeTypeNode = operation.explicitPointeeTypeNode;
    if (pointeeTypeNode === undefined) {
      continue;
    }
    const propertyNode = source.ast.parent(operation.call);
    if (propertyNode === undefined || !IsPropertyAccessExpression(propertyNode)) {
      continue;
    }
    const property = AsPropertyAccessExpression(propertyNode);
    const propertyNameNode = property?.name;
    if (
      property === undefined ||
      property.Expression !== operation.call ||
      propertyNameNode === undefined ||
      !IsIdentifier(propertyNameNode)
    ) {
      continue;
    }
    const declarationNode = source.ast.parent(propertyNode);
    if (declarationNode === undefined || !IsVariableDeclaration(declarationNode)) {
      continue;
    }
    const declaration = AsVariableDeclaration(declarationNode);
    if (
      declaration === undefined ||
      declaration.Initializer !== propertyNode ||
      declaration.Type !== undefined ||
      source.ast.getSourceFile(declarationNode) !== sourceFile
    ) {
      continue;
    }
    const reference = source.navigation.sourceReferenceFor(propertyNameNode);
    const expressionType = source.semantics.forNode(propertyNode)
      .types.expressionType(propertyNode);
    const declaredType = source.semantics.forNode(propertyNode)
      .types.typeOfSymbol(reference?.symbol);
    if (
      reference === undefined ||
      reference.symbol === undefined ||
      expressionType === undefined ||
      declaredType === undefined ||
      !source.semantics.forNode(propertyNode).types.isIdentical(
        expressionType,
        declaredType,
      )
    ) {
      continue;
    }
    const propertyName = source.ast.text(propertyNameNode);
    if (propertyName.length === 0 || stabilizations.has(declarationNode)) {
      throw new PointerLoweringError(
        "pointer inference stabilization lacks one exact declaration property",
      );
    }
    stabilizations.set(declarationNode, Object.freeze({
      declaration: declarationNode,
      pointeeTypeNode,
      propertyName,
    }));
  }
  return stabilizations;
}

export function applyPointerInferenceStabilization(
  factory: NodeFactory,
  original: Node,
  updated: Node,
  stabilization: PointerInferenceStabilization,
  finalNodes: FinalNodeLookup,
): Node {
  if (stabilization.declaration !== original) {
    throw new PointerLoweringError(
      "pointer inference stabilization belongs to another declaration",
    );
  }
  const originalDeclaration = AsVariableDeclaration(original);
  const updatedDeclaration = AsVariableDeclaration(updated);
  const pointeeType = finalNodes.forOriginal(stabilization.pointeeTypeNode);
  if (
    originalDeclaration === undefined ||
    updatedDeclaration === undefined ||
    originalDeclaration.Type !== undefined ||
    updatedDeclaration.Type !== undefined ||
    updatedDeclaration.Initializer === undefined ||
    pointeeType === undefined
  ) {
    throw new PointerLoweringError(
      "pointer inference stabilization lost its exact declaration shape",
    );
  }
  const propertyLiteral = NewStringLiteral(
    factory,
    stabilization.propertyName,
    0,
  );
  const indexType = propertyLiteral === undefined
    ? undefined
    : NewLiteralTypeNode(factory, propertyLiteral);
  const typeNode = indexType === undefined
    ? undefined
    : NewIndexedAccessTypeNode(factory, pointeeType, indexType);
  if (typeNode === undefined) {
    throw new PointerLoweringError(
      "pointer inference stabilization could not construct its indexed type",
    );
  }
  const rewritten = NodeFactory_UpdateVariableDeclaration(
    factory,
    updatedDeclaration,
    updatedDeclaration.name,
    updatedDeclaration.ExclamationToken,
    typeNode,
    updatedDeclaration.Initializer,
  );
  if (rewritten === undefined) {
    throw new PointerLoweringError(
      "pointer inference stabilization could not update its declaration",
    );
  }
  return rewritten;
}
