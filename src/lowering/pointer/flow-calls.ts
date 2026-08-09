import type { Node } from "@tsonic/tsts";

import type { PointerCensus } from "./flow-census.js";
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
  for (const node of census.nodes) {
    if (!source.ast.is.IsCallExpression(node) || operations.has(node)) {
      continue;
    }
    const call = source.ast.as.AsCallExpression(node);
    const arguments_ = source.ast.arguments(node);
    const argumentVertices = arguments_.map((argument) =>
      resolvePointerExpression(
        source,
        census.references,
        graph,
        operations,
        argument,
      )
    );
    const hasKnownPointerArgument = argumentVertices.some(
      (value) => value !== undefined,
    );
    const directTarget = transparentReference(source, call?.Expression);
    const directDeclaration = directTarget === undefined
      ? source.navigation.sourceReferenceFor(call?.Expression)?.declaration
      : census.references.referenceFor(directTarget)?.declaration;
    if (
      !hasKnownPointerArgument &&
      (directDeclaration === undefined ||
        census.functionParameters.get(directDeclaration) === undefined)
    ) {
      continue;
    }
    const semantics = source.semantics.forNode(node);
    const info = semantics.getResolvedCallInfo(node);
    const selectedParameters = info?.sourceSelectedSignatureParameters ?? [];
    const hasPointerParameter = selectedParameters.some((parameter) =>
      graph.get(parameter.parameterDeclaration) !== undefined
    );
    if (!hasPointerParameter && !hasKnownPointerArgument) {
      continue;
    }
    if (
      info === undefined ||
      info.sourceSelectedSignatureKind !== "resolved" ||
      info.optionalChain ||
      call?.Expression === undefined
    ) {
      blockAll(graph, argumentVertices);
      blockSelectedParameters(graph, selectedParameters);
      continue;
    }
    const boundParameters = new Set<Node>();
    const selectedDeclaration = semantics.getSignatureDeclaration(
      info.selectedSignature,
    );
    for (const binding of info.sourceArgumentBindings) {
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
        source.ast.parent(parameterDeclaration) !== selectedDeclaration ||
        census.optimizableFunctions.get(selectedDeclaration) !== true
      ) {
        graph.block(argumentVertex, "open-call");
        graph.block(parameterVertex, "open-call");
        continue;
      }
      graph.union(argumentVertex, parameterVertex);
      boundParameters.add(parameterDeclaration);
      addTransparentReference(source, argument, census.allowedPointerReferences);
      addTransparentProducer(source, argument, operations, census.allowedProducerUses);
      census.allowedFunctionTargets.add(call.Expression);
      const targetName = source.ast.name(call.Expression);
      if (targetName !== undefined) {
        census.allowedFunctionTargets.add(targetName);
      }
    }
    for (const parameter of selectedParameters) {
      const declaration = parameter.parameterDeclaration;
      const vertex = graph.get(declaration);
      if (
        vertex !== undefined &&
        declaration !== undefined &&
        !boundParameters.has(declaration)
      ) {
        graph.block(vertex, "open-call");
      }
    }
  }
}

function blockAll(
  graph: PointerFlowGraph,
  vertices: readonly (PointerFlowVertex | undefined)[],
): void {
  for (const vertex of vertices) {
    graph.block(vertex, "open-call");
  }
}

function blockSelectedParameters(
  graph: PointerFlowGraph,
  parameters: readonly { readonly parameterDeclaration?: Node }[],
): void {
  for (const parameter of parameters) {
    graph.block(graph.get(parameter.parameterDeclaration), "open-call");
  }
}
