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

import type { TargetProgramIndex } from "../../../program-index.js";
import type {
  InvocationTransport,
  InvocationTransportContract,
} from "../../../invocation-transport.js";
import {
  interfaceContractTypeDeclaration,
  isExactInterfaceProjectDeclaration,
} from "./declarations.js";
import {
  type InterfaceContractIngress,
  interfaceValueOriginIsClosedForType,
  retainOpenInterfaceReceiver,
  retainUnprovenInterfaceIngress,
} from "./ingress.js";
import type { InterfaceContractRelevance } from "./relevance.js";
import type { InterfaceContractBoundaryReason } from "./boundary.js";
import {
  callCrossesOpaqueInterfaceBoundary,
  isFreshInterfaceTransportAggregate,
} from "./transport-context.js";
import {
  opaqueInterfaceSourceContainsContracts,
  retainOpaqueInterfaceInputs,
} from "./opaque-exposure.js";
import { callHasExactBindings } from "../invocation/call-binding.js";
import { isDiscardedCall } from "../../model/syntax.js";

export interface InterfaceCallTransportSink {
  processTypePair(
    semantics: SourceFileSemantics,
    source: Type,
    target: Type,
    sourceExpression: Node,
  ): void;
  markExposedContracts(
    semantics: SourceFileSemantics,
    root: Type,
    occurrence: Node,
    reason: InterfaceContractBoundaryReason,
  ): void;
  markExposedValueContracts(
    semantics: SourceFileSemantics,
    root: Type,
    occurrence: Node,
    reason: InterfaceContractBoundaryReason,
  ): void;
}

interface InterfaceCallTransportAnalysis {
  readonly node: Node;
  readonly semantics: SourceFileSemantics;
  readonly call?: ResolvedSourceCallInfo;
  readonly transport?: InvocationTransport;
  readonly opaqueBoundary: boolean;
  readonly exactBindings: boolean;
}

export function collectInterfaceCallTransports(
  source: TargetSourceProgram,
  program: TargetProgramIndex,
  relevance: InterfaceContractRelevance,
  ingress: InterfaceContractIngress,
  sink: InterfaceCallTransportSink,
  transports?: InvocationTransportContract,
): void {
  const calls: InterfaceCallTransportAnalysis[] = [];
  for (const kind of [KindCallExpression, KindNewExpression]) {
    for (const node of program.nodesOfKind(kind)) {
      const semantics = source.semantics.forNode(node);
      const call = semantics.getResolvedCallInfo(node);
      const declaration = call === undefined
        ? undefined
        : semantics.getSignatureDeclaration(call.selectedSignature);
      const transport = transports?.transportFor(node);
      calls.push({
        node,
        semantics,
        ...(call === undefined ? {} : { call }),
        ...(transport === undefined ? {} : { transport }),
        opaqueBoundary: call !== undefined &&
          callCrossesOpaqueInterfaceBoundary(
            source,
            declaration,
            ingress.entries,
          ),
        exactBindings: call !== undefined && callHasExactBindings(
          source,
          node,
          call,
          declaration,
        ),
      });
    }
  }
  for (const analysis of calls) {
    retainOpaqueCallInputs(
      source,
      relevance,
      ingress,
      sink,
      analysis,
    );
  }
  for (const analysis of calls) {
    const { node, semantics, call } = analysis;
    retainOpenInterfaceReceiver(semantics, node, call, ingress);
    processCallTransports(
      source,
      relevance,
      ingress,
      sink,
      analysis,
    );
  }
}

function processCallTransports(
  source: TargetSourceProgram,
  relevance: InterfaceContractRelevance,
  ingress: InterfaceContractIngress,
  sink: InterfaceCallTransportSink,
  analysis: InterfaceCallTransportAnalysis,
): void {
  const { node, semantics, call, opaqueBoundary, exactBindings } = analysis;
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
  if (transportTypes.some((type) => relevance.contains(semantics, type))) {
    if (!exactBindings) {
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
        if (binding.sourceForm === "value") {
          sink.processTypePair(
            semantics,
            sourceArgument.type,
            binding.selectedArgumentType,
            sourceArgument.expression,
          );
        }
        sink.processTypePair(
          semantics,
          binding.selectedArgumentType,
          binding.selectedParameterType,
          sourceArgument.expression,
        );
        retainUnprovenInterfaceIngress(
          semantics,
          sourceArgument.expression,
          binding.selectedArgumentType,
          binding.selectedParameterType,
          ingress,
        );
      }
    }
  }
  if (
    opaqueBoundary &&
    !exactBindings &&
    call.sourceArguments.some((argument) =>
      opaqueInterfaceSourceContainsContracts(
        semantics,
        argument.type,
        relevance,
      )
    )
  ) {
    for (const argument of call.sourceArguments) {
      if (
        !opaqueInterfaceSourceContainsContracts(
          semantics,
          argument.type,
          relevance,
        )
      ) {
        continue;
      }
      sink.markExposedContracts(
        semantics,
        argument.type,
        node,
        "inexact-call-bindings",
      );
      sink.markExposedValueContracts(
        semantics,
        argument.type,
        node,
        "inexact-call-bindings",
      );
    }
  }
  retainOpaqueCallResult(
    source,
    semantics,
    node,
    call,
    opaqueBoundary,
    relevance,
    ingress,
    sink,
  );
}

function retainOpaqueCallInputs(
  source: TargetSourceProgram,
  relevance: InterfaceContractRelevance,
  ingress: InterfaceContractIngress,
  sink: InterfaceCallTransportSink,
  analysis: InterfaceCallTransportAnalysis,
): void {
  const { call, opaqueBoundary, exactBindings, semantics, transport } = analysis;
  if (call === undefined || !opaqueBoundary || !exactBindings) {
    return;
  }
  for (const binding of call.sourceArgumentBindings) {
    const sourceArgument = call.sourceArguments[binding.sourceArgumentIndex];
    if (sourceArgument === undefined) {
      throw new Error("resolved call lost its exact source argument");
    }
    if (transport?.inputExpressions.includes(sourceArgument.expression) === true) {
      continue;
    }
    retainOpaqueInterfaceInputs(
      source,
      semantics,
      binding.sourceForm === "value"
        ? sourceArgument.type
        : binding.selectedArgumentType,
      binding.selectedParameterType,
      isFreshInterfaceTransportAggregate(
        source,
        sourceArgument.expression,
      ),
      relevance,
      {
        markOpaqueInput(declaration) {
          ingress.opaqueInputs.mark(declaration);
        },
        markExposedContracts(selectedSemantics, root) {
          sink.markExposedContracts(
            selectedSemantics,
            root,
            sourceArgument.expression,
            "opaque-call-transport",
          );
        },
        markExposedValueContracts(selectedSemantics, root) {
          sink.markExposedValueContracts(
            selectedSemantics,
            root,
            sourceArgument.expression,
            "opaque-call-transport",
          );
        },
      },
    );
  }
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

function retainOpaqueCallResult(
  source: TargetSourceProgram,
  semantics: SourceFileSemantics,
  node: Node,
  call: ResolvedSourceCallInfo,
  opaqueBoundary: boolean,
  relevance: InterfaceContractRelevance,
  ingress: InterfaceContractIngress,
  sink: InterfaceCallTransportSink,
): void {
  if (isDiscardedCall(source, node)) {
    return;
  }
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
  if (
    opaqueBoundary &&
    relevance.contains(semantics, call.sourceResultType) &&
    !interfaceValueOriginIsClosedForType(
      semantics,
      node,
      call.sourceResultType,
      ingress,
    )
  ) {
    sink.markExposedValueContracts(
      semantics,
      call.sourceResultType,
      node,
      "opaque-call-transport",
    );
  }
}
