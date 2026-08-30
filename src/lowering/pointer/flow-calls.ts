import type { Node } from "@tsonic/tsts";
import { KindCallExpression } from "@tsonic/tsts/target-ast";

import type { PointerCensus } from "./flow-census.js";
import type { ExactIdentityTransportCall } from "./flow-identity-transports.js";
import type {
  PointerFlowGraph,
  PointerFlowVertex,
} from "./flow-graph.js";
import {
  addTransparentProducer,
  addTransparentReference,
  resolvePointerExpression,
  transparentReference,
} from "./flow-syntax.js";

export function connectPointerCalls(census: PointerCensus): void {
  const { source, graph, operations } = census;
  const candidates = census.program.nodesOfKind(KindCallExpression);
  for (const node of census.ledger.candidates(
    "flow-census",
    "pointer-call",
    candidates,
  )) {
    if (operations.has(node)) {
      continue;
    }
    const call = source.ast.as.AsCallExpression(node);
    const arguments_ = source.ast.arguments(node);
    const argumentVertices = arguments_.map((argument) => {
      census.ledger.record("flow-census");
      return resolvePointerExpression(
        source,
        census.references,
        graph,
        operations,
        argument,
      );
    });
    let hasKnownPointerArgument = false;
    for (const value of argumentVertices) {
      census.ledger.record("flow-census");
      hasKnownPointerArgument ||= value !== undefined;
    }
    const directTarget = transparentReference(source, call?.Expression);
    const identityTransport = census.identityTransportCalls.get(node);
    const directDeclaration = census.callableAliases.ownerForTarget(
      call?.Expression,
    ) ?? (directTarget === undefined
      ? source.navigation.sourceReferenceFor(call?.Expression)?.declaration
      : census.references.referenceFor(directTarget)?.declaration) ??
      identityTransport?.declaration;
    if (
      !hasKnownPointerArgument &&
      (directDeclaration === undefined ||
        census.functionParameters.get(directDeclaration) === undefined)
    ) {
      continue;
    }
    const semantics = source.semantics.forNode(node);
    const info = semantics.operations.call(node);
    const selectedParameters = info?.sourceSelectedSignatureParameters ?? [];
    let hasPointerParameter = false;
    for (const parameter of selectedParameters) {
      census.ledger.record("flow-census");
      hasPointerParameter ||= graph.get(parameter.parameterDeclaration) !== undefined;
    }
    if (!hasPointerParameter && !hasKnownPointerArgument) {
      continue;
    }
    if (
      identityTransport !== undefined &&
      connectIdentityTransport(census, identityTransport, argumentVertices[0])
    ) {
      continue;
    }
    if (
      info === undefined ||
      info.sourceSelectedSignatureKind !== "resolved" ||
      info.optionalChain ||
      call?.Expression === undefined
    ) {
      blockAll(graph, argumentVertices, "external-boundary", node);
      blockSelectedParameters(
        graph,
        selectedParameters,
        "external-boundary",
        node,
      );
      continue;
    }
    const boundParameters = new Set<Node>();
    const transportedParameters = census.representationTransportCalls.get(node);
    const selectedDeclaration = semantics.declarations.signatureDeclaration(
      info.selectedSignature,
    );
    for (const binding of info.sourceArgumentBindings) {
      census.ledger.record("flow-census");
      const argument = info.sourceArguments[binding.sourceArgumentIndex]?.expression;
      const inferredArgumentVertex = argumentVertices[binding.sourceArgumentIndex];
      const parameter = selectedParameters[binding.sourceParameterIndex];
      const parameterDeclaration = parameter?.parameterDeclaration;
      const parameterVertex = graph.get(parameterDeclaration);
      const argumentVertex = parameterVertex === undefined
        ? inferredArgumentVertex
        : resolvePointerExpression(
          source,
          census.references,
          graph,
          operations,
          argument,
        );
      if (
        argument !== undefined &&
        argumentVertex === undefined &&
        parameterDeclaration !== undefined &&
        parameterVertex !== undefined &&
        binding.sourceParameterForm === "parameter" &&
        parameter?.rest !== true &&
        parameter?.acceptsOmission !== true &&
        selectedDeclaration !== undefined &&
        selectedDeclaration === directDeclaration &&
        source.ast.parent(parameterDeclaration) === selectedDeclaration &&
        census.optimizableFunctions.get(selectedDeclaration) === true &&
        isExactNullishValue(census, argument)
      ) {
        graph.block(parameterVertex, "nil-capable", argument);
        boundParameters.add(parameterDeclaration);
        allowFunctionTarget(census, call.Expression);
        continue;
      }
      if (argumentVertex === undefined && parameterVertex === undefined) {
        continue;
      }
      if (
        argument === undefined ||
        argumentVertex === undefined ||
        parameterDeclaration === undefined ||
        parameterVertex === undefined ||
        binding.sourceParameterForm !== "parameter" ||
        parameter?.rest === true ||
        parameter?.acceptsOmission === true ||
        selectedDeclaration === undefined ||
        selectedDeclaration !== directDeclaration ||
        source.ast.parent(parameterDeclaration) !== selectedDeclaration ||
        census.optimizableFunctions.get(selectedDeclaration) !== true
      ) {
        if (
          parameterDeclaration !== undefined &&
          transportedParameters?.has(parameterDeclaration) === true &&
          argument !== undefined &&
          argumentVertex !== undefined &&
          binding.sourceParameterForm === "parameter" &&
          parameter?.rest !== true &&
          parameter?.acceptsOmission !== true &&
          selectedDeclaration !== undefined &&
          selectedDeclaration === directDeclaration &&
          source.ast.parent(parameterDeclaration) === selectedDeclaration
        ) {
          boundParameters.add(parameterDeclaration);
          addTransparentReference(
            source,
            argument,
            census.allowedPointerReferences,
          );
          addTransparentProducer(
            source,
            argument,
            operations,
            census.allowedProducerUses,
            census.resultExpressions,
          );
          allowFunctionTarget(census, call.Expression);
          continue;
        }
        const blocker = callBoundaryBlocker(source, selectedDeclaration);
        graph.block(argumentVertex, blocker, node);
        graph.block(parameterVertex, blocker, node);
        continue;
      }
      graph.union(argumentVertex, parameterVertex);
      boundParameters.add(parameterDeclaration);
      addTransparentReference(source, argument, census.allowedPointerReferences);
      addTransparentProducer(
        source,
        argument,
        operations,
        census.allowedProducerUses,
        census.resultExpressions,
      );
      allowFunctionTarget(census, call.Expression);
    }
    for (const parameter of selectedParameters) {
      census.ledger.record("flow-census");
      const declaration = parameter.parameterDeclaration;
      const vertex = graph.get(declaration);
      if (
        vertex !== undefined &&
        declaration !== undefined &&
        !boundParameters.has(declaration)
      ) {
        graph.block(vertex, "open-call", node);
      }
    }
  }
  census.ledger.assertCandidateCount("pointer-call", candidates.length);
}

function connectIdentityTransport(
  census: PointerCensus,
  transport: ExactIdentityTransportCall,
  argumentVertex: PointerFlowVertex | undefined,
): boolean {
  const { source, graph } = census;
  const parameterVertex = graph.get(transport.parameter);
  const resultVertex = census.functionResults.get(transport.declaration)?.vertex;
  const callVertex = graph.get(transport.call);
  if (
    argumentVertex === undefined ||
    parameterVertex === undefined ||
    resultVertex === undefined ||
    callVertex === undefined
  ) {
    return false;
  }
  graph.union(argumentVertex, parameterVertex);
  graph.union(argumentVertex, resultVertex);
  graph.union(argumentVertex, callVertex);
  addTransparentReference(
    source,
    transport.argument,
    census.allowedPointerReferences,
  );
  addTransparentProducer(
    source,
    transport.argument,
    census.operations,
    census.allowedProducerUses,
    census.resultExpressions,
  );
  const call = source.ast.as.AsCallExpression(transport.call);
  if (call?.Expression !== undefined) {
    allowFunctionTarget(census, call.Expression);
  }
  return true;
}

function isExactNullishValue(census: PointerCensus, expression: Node): boolean {
  const semantics = census.source.semantics.forNode(expression);
  const type = semantics.types.expressionType(expression);
  return type !== undefined && semantics.types.isNullish(type);
}

function allowFunctionTarget(census: PointerCensus, target: Node): void {
  census.allowedFunctionTargets.add(target);
  const targetName = census.source.ast.name(target);
  if (targetName !== undefined) {
    census.allowedFunctionTargets.add(targetName);
  }
}

function blockAll(
  graph: PointerFlowGraph,
  vertices: readonly (PointerFlowVertex | undefined)[],
  blocker: "external-boundary" | "open-call",
  occurrence: Node,
): void {
  for (const vertex of vertices) {
    graph.block(vertex, blocker, occurrence);
  }
}

function blockSelectedParameters(
  graph: PointerFlowGraph,
  parameters: readonly { readonly parameterDeclaration?: Node }[],
  blocker: "external-boundary" | "open-call",
  occurrence: Node,
): void {
  for (const parameter of parameters) {
    graph.block(graph.get(parameter.parameterDeclaration), blocker, occurrence);
  }
}

function callBoundaryBlocker(
  source: PointerCensus["source"],
  declaration: Node | undefined,
): "external-boundary" | "open-call" {
  const sourceFile = source.ast.getSourceFile(declaration);
  return declaration === undefined ||
      sourceFile === undefined ||
      source.ast.isDeclarationFile(sourceFile)
    ? "external-boundary"
    : "open-call";
}
