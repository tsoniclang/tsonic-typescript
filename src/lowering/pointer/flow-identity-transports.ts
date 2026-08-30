import type { Node } from "@tsonic/tsts";
import { IsDecorator, KindCallExpression } from "@tsonic/tsts/target-ast";
import type { TargetSourceProgram } from "@tsonic/target-api/source";

import type { TargetProgramIndex } from "../program-index.js";
import {
  createRepresentationBindingProof,
  type RepresentationBindingProof,
} from "../representation/binding-proof.js";
import type { PointerFunctionResult } from "./flow-results.js";
import type { PointerPlanningLedger } from "./planning-ledger.js";

export interface ExactIdentityTransportCall {
  readonly call: Node;
  readonly declaration: Node;
  readonly parameter: Node;
  readonly argument: Node;
}

export function selectExactIdentityTransportCalls(
  source: TargetSourceProgram,
  program: TargetProgramIndex,
  functionParameters: ReadonlyMap<Node, readonly Node[]>,
  functionResults: ReadonlyMap<Node, PointerFunctionResult>,
  ledger: PointerPlanningLedger,
): ReadonlyMap<Node, ExactIdentityTransportCall> {
  const selected = new Map<Node, ExactIdentityTransportCall>();
  const bindingProof = createRepresentationBindingProof(source, program);
  const candidates = program.nodesOfKind(KindCallExpression);
  for (const call of ledger.candidates(
    "flow-census",
    "identity-transport-call",
    candidates,
  )) {
    const transport = exactIdentityTransportCall(
      source,
      program,
      functionParameters,
      functionResults,
      bindingProof,
      call,
    );
    if (transport !== undefined) {
      selected.set(call, transport);
    }
  }
  ledger.assertCandidateCount("identity-transport-call", candidates.length);
  return selected;
}

function exactIdentityTransportCall(
  source: TargetSourceProgram,
  program: TargetProgramIndex,
  functionParameters: ReadonlyMap<Node, readonly Node[]>,
  functionResults: ReadonlyMap<Node, PointerFunctionResult>,
  bindingProof: RepresentationBindingProof,
  callNode: Node,
): ExactIdentityTransportCall | undefined {
  const call = source.ast.as.AsCallExpression(callNode);
  const arguments_ = source.ast.arguments(callNode);
  const target = call?.Expression;
  if (
    call === undefined ||
    call.QuestionDotToken !== undefined ||
    (call.TypeArguments?.Nodes.length ?? 0) !== 0 ||
    arguments_.length !== 1 ||
    target === undefined ||
    !source.ast.is.IsPropertyAccessExpression(target)
  ) {
    return undefined;
  }
  const access = source.ast.as.AsPropertyAccessExpression(target);
  const declaration = source.navigation.sourceReferenceFor(access?.name)?.declaration;
  const owner = declaration === undefined ? undefined : source.ast.parent(declaration);
  const receiver = source.navigation.sourceReferenceFor(access?.Expression);
  if (
    declaration === undefined ||
    owner === undefined ||
    receiver?.project !== true ||
    receiver.declaration !== owner ||
    !source.navigation.isProjectDeclaration(declaration) ||
    !source.navigation.isProjectDeclaration(owner) ||
    !source.ast.is.IsMethodDeclaration(declaration) ||
    !source.ast.is.IsClassDeclaration(owner) ||
    !source.ast.hasModifierKind(declaration, "private") ||
    !source.ast.hasModifierKind(declaration, "static") ||
    source.ast.hasModifierKind(declaration, "async") ||
    source.ast.typeParameters(declaration).length !== 0 ||
    source.ast.modifiers(declaration).some((modifier) => IsDecorator(modifier)) ||
    !bindingProof.classValueReferencesAreClosed(owner) ||
    program.hasBindingWrite(declaration) ||
    program.hasBindingWrite(owner)
  ) {
    return undefined;
  }
  const method = source.ast.as.AsMethodDeclaration(declaration);
  const parameters = source.ast.parameters(declaration);
  const parameter = parameters[0];
  const trackedParameters = functionParameters.get(declaration);
  const result = functionResults.get(declaration);
  const body = source.ast.body(declaration);
  const statements = source.ast.statements(body);
  const returnStatement = statements.length === 1 && statements[0] !== undefined &&
      source.ast.is.IsReturnStatement(statements[0])
    ? source.ast.as.AsReturnStatement(statements[0])
    : undefined;
  const returned = returnStatement?.Expression;
  const returnedReference = source.navigation.sourceReferenceFor(returned);
  const parsedParameter = source.ast.as.AsParameterDeclaration(parameter);
  const argument = arguments_[0];
  if (
    method?.AsteriskToken !== undefined ||
    parameters.length !== 1 ||
    parameter === undefined ||
    argument === undefined ||
    trackedParameters?.length !== 1 ||
    trackedParameters[0] !== parameter ||
    result === undefined ||
    body === undefined ||
    returned === undefined ||
    !source.ast.is.IsIdentifier(returned) ||
    returnedReference?.project !== true ||
    returnedReference.declaration !== parameter ||
    parsedParameter?.DotDotDotToken !== undefined ||
    parsedParameter?.QuestionToken !== undefined ||
    parsedParameter?.Initializer !== undefined
  ) {
    return undefined;
  }
  const parameterTypeNode = source.ast.typeNode(parameter);
  const resultTypeNode = source.ast.typeNode(declaration);
  const parameterType = parameterTypeNode === undefined
    ? undefined
    : source.semantics.forNode(parameterTypeNode).types.authoredType(parameterTypeNode);
  const resultType = resultTypeNode === undefined
    ? undefined
    : source.semantics.forNode(resultTypeNode).types.authoredType(resultTypeNode);
  const callSemantics = source.semantics.forNode(callNode);
  const argumentType = callSemantics.types.expressionType(argument);
  const callType = callSemantics.types.expressionType(callNode);
  if (
    parameterType === undefined ||
    resultType === undefined ||
    argumentType === undefined ||
    callType === undefined ||
    callSemantics.types.relationship(parameterType, resultType) !== "identical" ||
    callSemantics.types.relationship(argumentType, parameterType) !== "identical" ||
    callSemantics.types.relationship(callType, resultType) !== "identical"
  ) {
    return undefined;
  }
  return Object.freeze({
    call: callNode,
    declaration,
    parameter,
    argument,
  });
}
