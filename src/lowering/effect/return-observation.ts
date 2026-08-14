import type { Node } from "@tsonic/tsts";
import type { TargetSourceProgram } from "@tsonic/target-api";
import { KindParameter } from "@tsonic/tsts/target-ast";

import type { TargetProgramIndex } from "../program-index.js";

import { isTransparentParent } from "./callable-input-reference.js";
import { closeDependencyCandidates } from "./dependency-closure.js";
import {
  exactCallableTarget,
  transparentExpression,
} from "./syntax.js";

export interface ReturnObservationFlow {
  referenceIsClosed(reference: Node): boolean;
}

interface ObservationCandidate {
  readonly declaration: Node;
  readonly parameters: ReadonlySet<Node>;
  readonly expression: Node;
  readonly dependencies: Set<Node>;
}

const pureBinaryOperatorKinds = new Set([
  "KindEqualsEqualsEqualsToken",
  "KindExclamationEqualsEqualsToken",
  "KindAmpersandAmpersandToken",
  "KindBarBarToken",
  "KindQuestionQuestionToken",
]);
const strictIdentityOperatorKinds = new Set([
  "KindEqualsEqualsEqualsToken",
  "KindExclamationEqualsEqualsToken",
]);
const literalKindNames = new Set([
  "KindTrueKeyword",
  "KindFalseKeyword",
  "KindNullKeyword",
]);

export function createReturnObservationFlow(
  source: TargetSourceProgram,
  program: TargetProgramIndex,
): ReturnObservationFlow {
  const candidates = collectCandidates(source, program);
  const structurallyValid = new Set<Node>();
  const dependencies = new Map<Node, ReadonlySet<Node>>();
  for (const candidate of candidates.values()) {
    if (expressionIsPureObservation(
      source,
      candidate.expression,
      candidate.parameters,
      candidates,
      candidate.dependencies,
    )) {
      structurallyValid.add(candidate.declaration);
      dependencies.set(candidate.declaration, candidate.dependencies);
    }
  }
  const closed = closeDependencyCandidates(
    structurallyValid,
    [dependencies],
  );
  return Object.freeze({
    referenceIsClosed(reference: Node): boolean {
      return strictIdentityObservationIsPure(source, reference, closed) ||
        closedObservationCallAtReference(source, reference, closed) !== undefined;
    },
  });
}

function collectCandidates(
  source: TargetSourceProgram,
  program: TargetProgramIndex,
): ReadonlyMap<Node, ObservationCandidate> {
  const result = new Map<Node, ObservationCandidate>();
  for (const parameter of program.nodesOfKind(KindParameter)) {
    const declaration = source.ast.parent(parameter);
    if (
      declaration === undefined ||
      result.has(declaration) ||
      !observationFunctionIsInspectable(source, program, declaration)
    ) {
      continue;
    }
    const body = source.ast.body(declaration);
    const statement = body === undefined
      ? undefined
      : source.ast.statements(body)[0];
    const expression = statement !== undefined &&
        source.ast.is.IsReturnStatement(statement)
      ? source.ast.as.AsReturnStatement(statement)?.Expression
      : undefined;
    const parameterNodes = source.ast.parameters(declaration);
    const parameters = parameterNodes.filter(
      (candidate): candidate is Node => candidate !== undefined,
    );
    if (
      expression === undefined ||
      !observationResultIsScalar(source, expression) ||
      parameters.length === 0 ||
      parameters.length !== parameterNodes.length ||
      parameters.some((candidate) => !simpleParameter(source, candidate))
    ) {
      continue;
    }
    result.set(declaration, {
      declaration,
      parameters: new Set(parameters),
      expression,
      dependencies: new Set(),
    });
  }
  return result;
}

function observationResultIsScalar(
  source: TargetSourceProgram,
  expression: Node,
): boolean {
  const semantics = source.semantics.forNode(expression);
  const type = semantics.getTypeAtLocation(expression);
  return type !== undefined &&
    (semantics.isNever(type) ||
      semantics.isVoidLike(type) ||
      semantics.isNullish(type) ||
      semantics.isStringLike(type) ||
      semantics.isNumberLike(type) ||
      semantics.isBooleanLike(type) ||
      semantics.isBigIntLike(type));
}

function observationFunctionIsInspectable(
  source: TargetSourceProgram,
  program: TargetProgramIndex,
  declaration: Node,
): boolean {
  const body = source.ast.body(declaration);
  return source.ast.is.IsFunctionDeclaration(declaration) &&
    source.navigation.isProjectDeclaration(declaration) &&
    body !== undefined &&
    source.ast.is.IsBlock(body) &&
    source.ast.statements(body).length === 1 &&
    !source.ast.hasModifierKind(declaration, "async") &&
    source.ast.as.AsFunctionDeclaration(declaration)?.AsteriskToken === undefined &&
    !program.hasBindingWrite(declaration);
}

function simpleParameter(
  source: TargetSourceProgram,
  parameter: Node | undefined,
): parameter is Node {
  const selected = source.ast.as.AsParameterDeclaration(parameter);
  return parameter !== undefined &&
    source.ast.is.IsParameterDeclaration(parameter) &&
    source.ast.is.IsIdentifier(source.ast.name(parameter)) &&
    selected?.DotDotDotToken === undefined &&
    selected?.Initializer === undefined;
}

function expressionIsPureObservation(
  source: TargetSourceProgram,
  expression: Node,
  parameters: ReadonlySet<Node>,
  candidates: ReadonlyMap<Node, ObservationCandidate>,
  dependencies: Set<Node>,
): boolean {
  return expressionIsPure(
    source,
    expression,
    (identifier) => {
      const declaration = source.navigation.sourceReferenceFor(identifier)?.declaration;
      return (declaration !== undefined && parameters.has(declaration)) ||
        intrinsicNullishIdentifier(source, identifier);
    },
    (call) => {
      const declaration = exactObservationDeclaration(source, call);
      if (declaration === undefined || !candidates.has(declaration)) {
        return false;
      }
      dependencies.add(declaration);
      return source.ast.arguments(call).every((argument) =>
        argument !== undefined &&
        !source.ast.is.IsSpreadElement(argument) &&
        expressionIsPureObservation(
          source,
          argument,
          parameters,
          candidates,
          dependencies,
        )
      );
    },
  );
}

function expressionIsPureAtCallSite(
  source: TargetSourceProgram,
  expression: Node,
  closed: ReadonlySet<Node>,
): boolean {
  return expressionIsPure(
    source,
    expression,
    () => true,
    (call) => {
      const declaration = exactObservationDeclaration(source, call);
      return declaration !== undefined &&
        closed.has(declaration) &&
        source.ast.arguments(call).every((argument) =>
          argument !== undefined &&
          !source.ast.is.IsSpreadElement(argument) &&
          expressionIsPureAtCallSite(source, argument, closed)
        );
    },
  );
}

function expressionIsPure(
  source: TargetSourceProgram,
  expression: Node,
  identifierIsPure: (identifier: Node) => boolean,
  callIsPure: (call: Node) => boolean,
): boolean {
  const root = transparentExpression(source, expression);
  if (root === undefined) {
    return false;
  }
  if (source.ast.is.IsIdentifier(root)) {
    return identifierIsPure(root);
  }
  if (isLiteral(source, root)) {
    return true;
  }
  if (source.ast.is.IsCallExpression(root)) {
    return callIsPure(root);
  }
  if (source.ast.is.IsConditionalExpression(root)) {
    const conditional = source.ast.as.AsConditionalExpression(root);
    return conditional?.Condition !== undefined &&
      conditional.WhenTrue !== undefined &&
      conditional.WhenFalse !== undefined &&
      expressionIsPure(source, conditional.Condition, identifierIsPure, callIsPure) &&
      expressionIsPure(source, conditional.WhenTrue, identifierIsPure, callIsPure) &&
      expressionIsPure(source, conditional.WhenFalse, identifierIsPure, callIsPure);
  }
  if (!source.ast.is.IsBinaryExpression(root)) {
    return false;
  }
  const operator = source.ast.operatorKindName(root);
  if (!pureBinaryOperatorKinds.has(operator ?? "")) {
    return false;
  }
  const binary = source.ast.as.AsBinaryExpression(root);
  return binary?.Left !== undefined &&
    binary.Right !== undefined &&
    expressionIsPure(source, binary.Left, identifierIsPure, callIsPure) &&
    expressionIsPure(source, binary.Right, identifierIsPure, callIsPure);
}

function isLiteral(source: TargetSourceProgram, node: Node): boolean {
  return source.ast.is.IsStringLiteral(node) ||
    source.ast.is.IsNumericLiteral(node) ||
    source.ast.is.IsBigIntLiteral(node) ||
    source.ast.is.IsNoSubstitutionTemplateLiteral(node) ||
    literalKindNames.has(source.ast.kindName(node));
}

function intrinsicNullishIdentifier(
  source: TargetSourceProgram,
  node: Node,
): boolean {
  if (source.navigation.sourceReferenceFor(node) !== undefined) {
    return false;
  }
  const semantics = source.semantics.forNode(node);
  const type = semantics.getTypeAtLocation(node);
  return type !== undefined && semantics.isNullish(type);
}

function strictIdentityObservationIsPure(
  source: TargetSourceProgram,
  reference: Node,
  closed: ReadonlySet<Node>,
): boolean {
  let current = reference;
  for (;;) {
    const parent = source.ast.parent(current);
    if (parent === undefined) {
      return false;
    }
    if (isTransparentParent(source, parent, current)) {
      current = parent;
      continue;
    }
    if (
      !source.ast.is.IsBinaryExpression(parent) ||
      !strictIdentityOperatorKinds.has(source.ast.operatorKindName(parent) ?? "")
    ) {
      return false;
    }
    return expressionIsPureAtCallSite(source, parent, closed);
  }
}

function closedObservationCallAtReference(
  source: TargetSourceProgram,
  reference: Node,
  closed: ReadonlySet<Node>,
): Node | undefined {
  let current = reference;
  for (;;) {
    const parent = source.ast.parent(current);
    if (parent === undefined) {
      return undefined;
    }
    if (isTransparentParent(source, parent, current)) {
      current = parent;
      continue;
    }
    if (!source.ast.is.IsCallExpression(parent)) {
      return undefined;
    }
    const index = source.ast.arguments(parent).indexOf(current);
    const declaration = exactObservationDeclaration(source, parent);
    const parameter = index < 0 || declaration === undefined
      ? undefined
      : source.ast.parameters(declaration)[index];
    return declaration !== undefined &&
        parameter !== undefined &&
        closed.has(declaration) &&
        simpleParameter(source, parameter) &&
        expressionIsPureAtCallSite(source, parent, closed)
      ? parent
      : undefined;
  }
}

function exactObservationDeclaration(
  source: TargetSourceProgram,
  call: Node,
): Node | undefined {
  const semantics = source.semantics.forNode(call);
  const declaration = semantics.getSignatureDeclaration(
    semantics.getResolvedSignature(call),
  );
  const target = exactCallableTarget(
    source,
    source.ast.as.AsCallExpression(call)?.Expression,
  );
  const referenceNode = target !== undefined &&
      source.ast.is.IsPropertyAccessExpression(target)
    ? source.ast.as.AsPropertyAccessExpression(target)?.name
    : source.ast.name(target) ?? target;
  const reference = source.navigation.sourceReferenceFor(referenceNode);
  return declaration !== undefined &&
      reference?.project === true &&
      reference.declaration === declaration
    ? declaration
    : undefined;
}
