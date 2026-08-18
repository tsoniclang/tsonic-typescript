import type { Node, Type } from "@tsonic/tsts";
import type {
  ResolvedSourceCallInfo,
  SourceFileSemantics,
  TargetSourceProgram,
} from "@tsonic/target-api";
import {
  KindCallExpression,
  KindNewExpression,
} from "@tsonic/tsts/target-ast";

import type { TargetProgramIndex } from "../program-index.js";
import type { StorageOwnerTransportContract } from "../storage-owner-transport.js";
import {
  interfaceContractTypeDeclaration,
  isExactInterfaceProjectDeclaration,
} from "./interface-contract-declarations.js";
import {
  type InterfaceContractIngress,
  retainOpenInterfaceReceiver,
  retainUnprovenInterfaceIngress,
} from "./interface-contract-ingress.js";
import type { InterfaceContractRelevance } from "./interface-contract-relevance.js";
import type { InterfaceContractBoundaryReason } from "./interface-contract-boundary.js";
import { callCrossesOpaqueInterfaceBoundary } from "./interface-contract-transport-context.js";

export interface InterfaceCallTransportSink {
  processTypePair(
    semantics: SourceFileSemantics,
    source: Type,
    target: Type,
    sourceExpression: Node,
    crossesOpaqueCall: boolean,
  ): void;
  markExposedContracts(
    semantics: SourceFileSemantics,
    root: Type,
    occurrence: Node,
    reason: InterfaceContractBoundaryReason,
  ): void;
}

export function collectInterfaceCallTransports(
  source: TargetSourceProgram,
  program: TargetProgramIndex,
  relevance: InterfaceContractRelevance,
  ingress: InterfaceContractIngress,
  sink: InterfaceCallTransportSink,
  transports?: StorageOwnerTransportContract,
): void {
  for (const kind of [KindCallExpression, KindNewExpression]) {
    for (const node of program.nodesOfKind(kind)) {
      const semantics = source.semantics.forNode(node);
      const call = semantics.getResolvedCallInfo(node);
      retainOpenInterfaceReceiver(semantics, node, call, ingress);
      processCallTransports(
        source,
        semantics,
        node,
        call,
        relevance,
        ingress,
        sink,
        transports,
      );
    }
  }
}

function processCallTransports(
  source: TargetSourceProgram,
  semantics: SourceFileSemantics,
  node: Node,
  call: ResolvedSourceCallInfo | undefined,
  relevance: InterfaceContractRelevance,
  ingress: InterfaceContractIngress,
  sink: InterfaceCallTransportSink,
  transports?: StorageOwnerTransportContract,
): void {
  if (call === undefined) {
    retainUnresolvedCallTransports(source, semantics, node, relevance, sink);
    return;
  }
  const transportTypes = [
    ...call.sourceArguments.map((argument) => argument.type),
    ...call.sourceArgumentBindings.flatMap((binding) => [
      binding.selectedArgumentType,
      binding.selectedParameterType,
    ]),
  ];
  const declaration = semantics.getSignatureDeclaration(call.selectedSignature);
  const crossesOpaqueCall = transports?.transportFor(node) === undefined &&
    callCrossesOpaqueInterfaceBoundary(source, declaration);
  if (transportTypes.some((type) => relevance.contains(semantics, type))) {
    if (!callHasExactPositionalBindings(source, node, call, declaration)) {
      for (const type of transportTypes) {
        sink.markExposedContracts(
          semantics,
          type,
          node,
          "inexact-call-bindings",
        );
      }
    } else {
      for (const binding of call.sourceArgumentBindings) {
        const sourceArgument = call.sourceArguments[binding.sourceArgumentIndex];
        if (sourceArgument === undefined) {
          throw new Error("resolved call lost its exact source argument");
        }
        sink.processTypePair(
          semantics,
          sourceArgument.type,
          binding.selectedArgumentType,
          sourceArgument.expression,
          false,
        );
        sink.processTypePair(
          semantics,
          binding.selectedArgumentType,
          binding.selectedParameterType,
          sourceArgument.expression,
          crossesOpaqueCall,
        );
        retainUnprovenInterfaceIngress(
          semantics,
          sourceArgument.expression,
          sourceArgument.type,
          binding.selectedParameterType,
          ingress,
        );
      }
    }
  }
  retainOpaqueCallResult(
    source,
    semantics,
    node,
    call,
    crossesOpaqueCall,
    relevance,
    sink,
  );
}

function retainUnresolvedCallTransports(
  source: TargetSourceProgram,
  semantics: SourceFileSemantics,
  node: Node,
  relevance: InterfaceContractRelevance,
  sink: InterfaceCallTransportSink,
): void {
  const types = source.ast.arguments(node).flatMap((argument) => {
    const type = semantics.getTypeAtLocation(argument);
    return type === undefined ? [] : [type];
  });
  if (types.some((type) => relevance.contains(semantics, type))) {
    for (const type of types) {
      sink.markExposedContracts(
        semantics,
        type,
        node,
        "unresolved-call-transport",
      );
    }
  }
}

function callHasExactPositionalBindings(
  source: TargetSourceProgram,
  node: Node,
  call: ResolvedSourceCallInfo,
  declaration: Node | undefined,
): boolean {
  if (
    declaration === undefined ||
    call.outcome !== "applicable" ||
    call.sourceSelectedSignatureKind !== "resolved" ||
    call.optionalChain ||
    call.sourceArguments.length !== source.ast.arguments(node).length ||
    call.sourceArgumentBindings.length !== call.sourceArguments.length
  ) {
    return false;
  }
  const bound = new Set<number>();
  for (const binding of call.sourceArgumentBindings) {
    if (
      binding.sourceForm !== "value" ||
      binding.sourceParameterForm !== "parameter" ||
      bound.has(binding.sourceArgumentIndex) ||
      call.sourceArguments[binding.sourceArgumentIndex]?.expression !==
        source.ast.arguments(node)[binding.sourceArgumentIndex]
    ) {
      return false;
    }
    bound.add(binding.sourceArgumentIndex);
  }
  return bound.size === call.sourceArguments.length;
}

function retainOpaqueCallResult(
  source: TargetSourceProgram,
  semantics: SourceFileSemantics,
  node: Node,
  call: ResolvedSourceCallInfo,
  crossesOpaqueCall: boolean,
  relevance: InterfaceContractRelevance,
  sink: InterfaceCallTransportSink,
): void {
  if (source.ast.is.IsNewExpression(node)) {
    const declaration = interfaceContractTypeDeclaration(
      semantics,
      call.sourceResultType,
    );
    if (
      declaration !== undefined &&
      isExactInterfaceProjectDeclaration(source, declaration) &&
      (
        source.ast.is.IsClassDeclaration(declaration) ||
        source.ast.is.IsClassExpression(declaration)
      )
    ) {
      return;
    }
  }
  if (crossesOpaqueCall && relevance.contains(semantics, call.sourceResultType)) {
    sink.markExposedContracts(
      semantics,
      call.sourceResultType,
      node,
      "opaque-call-transport",
    );
  }
}
