import type { Node, Type } from "@tsonic/tsts";
import type {
  ResolvedSourceCallInfo,
  SourceFileSemantics,
  TargetSourceProgram,
} from "@tsonic/target-api/source";
import {
  KindCallExpression,
  KindNewExpression,
} from "@tsonic/tsts/target-ast";

import type { TargetProgramIndex } from "../../../program-index.js";
import type { TypeScriptPlanningObserver } from "../../../planning-observer.js";
import type {
  InvocationTransport,
  InvocationTransportContract,
} from "../../../invocation-transport.js";
import {
  interfaceContractTypeDeclaration,
} from "./declarations.js";
import { originDeclarationIsClosed } from "./origin-declaration.js";
import {
  type InterfaceContractIngress,
  retainOpaqueInterfaceResultOrigin,
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
  createOpaqueInterfaceExposureIndex,
  type OpaqueInterfaceExposureIndex,
} from "./opaque-exposure/index.js";
import {
  callHasExactBindings,
  exactSourceCallBindingInputs,
} from "../invocation/call-binding.js";
import {
  isDiscardedCall,
  callableDispatchIsClosed,
  successfulValueExpression,
} from "../../model/syntax.js";
import { sourceBodyInspectionIsExact } from "../../model/source-membership.js";

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
  planningObserver?: TypeScriptPlanningObserver,
): OpaqueInterfaceExposureIndex {
  const calls: InterfaceCallTransportAnalysis[] = [];
  const opaqueExposure = createOpaqueInterfaceExposureIndex(
    source,
    relevance,
    ingress.bodyInspectionIsCertified,
  );
  for (const kind of [KindCallExpression, KindNewExpression]) {
    for (const node of program.nodesOfKind(kind)) {
      const semantics = source.semantics.forNode(node);
      const call = semantics.operations.call(node);
      const declaration = call === undefined
        ? undefined
        : semantics.declarations.signatureDeclaration(call.selectedSignature);
      const transport = transports?.transportFor(node);
      calls.push({
        node,
        semantics,
        ...(call === undefined ? {} : { call }),
        ...(transport === undefined ? {} : { transport }),
        opaqueBoundary: call !== undefined &&
          !callHasExactInspectableImplementations(source, node, ingress) &&
          callCrossesOpaqueInterfaceBoundary(
            source,
            declaration,
            ingress.entries,
            ingress.bodyInspectionIsCertified,
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
  planningObserver?.("effect-interface-call-analysis", {
    calls: calls.length,
    boundaries: calls.filter((analysis) => analysis.opaqueBoundary).length,
  });
  for (const analysis of calls) {
    collectCheckedProviderParameters(source, ingress, analysis);
    retainOpaqueCallInputs(
      source,
      relevance,
      ingress,
      sink,
      analysis,
      opaqueExposure,
    );
  }
  planningObserver?.(
    "effect-interface-call-inputs",
    opaqueExposure.measurements(),
  );
  for (const analysis of calls) {
    const { node, semantics, call } = analysis;
    retainOpenInterfaceReceiver(semantics, node, call, ingress);
    processCallTransports(
      source,
      relevance,
      ingress,
      sink,
      analysis,
      opaqueExposure,
    );
  }
  planningObserver?.(
    "effect-interface-call-processing",
    relevance.measurements(),
  );
  return opaqueExposure;
}

function callHasExactInspectableImplementations(
  source: TargetSourceProgram,
  call: Node,
  ingress: InterfaceContractIngress,
): boolean {
  const implementations = ingress.exactCallImplementations?.(call);
  return implementations !== undefined &&
    implementations.length !== 0 &&
    implementations.every((implementation) =>
      sourceBodyInspectionIsExact(
        source,
        implementation,
        ingress.bodyInspectionIsCertified,
      ) && callableDispatchIsClosed(source, ingress.program, implementation)
    );
}

function collectCheckedProviderParameters(
  source: TargetSourceProgram,
  ingress: InterfaceContractIngress,
  analysis: InterfaceCallTransportAnalysis,
): void {
  const { call, exactBindings, semantics, transport } = analysis;
  if (call === undefined || !exactBindings || transport === undefined) {
    return;
  }
  for (const binding of call.sourceArgumentBindings) {
    const argument = call.sourceArguments[binding.sourceArgumentIndex];
    if (
      argument === undefined ||
      !transport.inputExpressions.includes(argument.expression)
    ) {
      continue;
    }
    const expression = successfulValueExpression(source, argument.expression);
    if (
      expression === undefined ||
      (
        !source.ast.is.IsArrowFunction(expression) &&
        !source.ast.is.IsFunctionExpression(expression)
      )
    ) {
      continue;
    }
    const parameters = source.ast.parameters(expression).filter(
      (parameter): parameter is Node => parameter !== undefined,
    );
    const sourceCallable = semantics.types.callable(
      binding.selectedArgumentType,
    );
    const targetCallable = semantics.types.callable(
      binding.selectedParameterType,
    );
    if (
      sourceCallable === undefined ||
      targetCallable === undefined ||
      sourceCallable.parameters.length !== parameters.length ||
      targetCallable.parameters.length !== parameters.length ||
      !sourceCallable.parameters.every((parameter, index) =>
        parameter.declaration === parameters[index] &&
        parameter.parameterKind === targetCallable.parameters[index]
          ?.parameterKind
      )
    ) {
      continue;
    }
    targetCallable.parameters.forEach((parameter, index) => {
      ingress.checkedParameterInputs.record(
        parameters[index]!,
        semantics,
        parameter.type,
        argument.expression,
      );
    });
  }
}

function processCallTransports(
  source: TargetSourceProgram,
  relevance: InterfaceContractRelevance,
  ingress: InterfaceContractIngress,
  sink: InterfaceCallTransportSink,
  analysis: InterfaceCallTransportAnalysis,
  opaqueExposure: OpaqueInterfaceExposureIndex,
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
        const inputs = exactSourceCallBindingInputs(
          source,
          sourceArgument.expression,
          binding,
          ingress.aggregateProjections,
        );
        if (inputs === undefined) {
          sink.markExposedContracts(
            semantics,
            binding.selectedParameterType,
            sourceArgument.expression,
            "inexact-call-bindings",
          );
          sink.markExposedValueContracts(
            semantics,
            binding.selectedParameterType,
            sourceArgument.expression,
            "inexact-call-bindings",
          );
          continue;
        }
        if (binding.sourceForm === "value") {
          sink.processTypePair(
            semantics,
            sourceArgument.type,
            binding.selectedArgumentType,
            inputs[0]!,
          );
        }
        for (const input of inputs) {
          sink.processTypePair(
            semantics,
            binding.selectedArgumentType,
            binding.selectedParameterType,
            input,
          );
          retainUnprovenInterfaceIngress(
            semantics,
            input,
            binding.selectedArgumentType,
            binding.selectedParameterType,
            ingress,
          );
        }
      }
    }
  }
  if (
    opaqueBoundary &&
    !exactBindings &&
    call.sourceArguments.some((argument) =>
      opaqueExposure.sourceContains(semantics, argument.type)
    )
  ) {
    for (const argument of call.sourceArguments) {
      if (
        !opaqueExposure.sourceContains(semantics, argument.type)
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
  );
}

function retainOpaqueCallInputs(
  source: TargetSourceProgram,
  relevance: InterfaceContractRelevance,
  ingress: InterfaceContractIngress,
  sink: InterfaceCallTransportSink,
  analysis: InterfaceCallTransportAnalysis,
  opaqueExposure: OpaqueInterfaceExposureIndex,
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
    opaqueExposure.retainInputs(
      semantics,
      binding.sourceForm === "value"
        ? sourceArgument.type
        : binding.selectedArgumentType,
      binding.selectedParameterType,
      isFreshInterfaceTransportAggregate(
        source,
        sourceArgument.expression,
      ),
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
    if (argument === undefined) {
      return [];
    }
    const type = semantics.types.expressionType(argument);
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
      originDeclarationIsClosed(
        source,
        declaration,
        ingress.bodyInspectionIsCertified,
      ) &&
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
    relevance.contains(semantics, call.sourceResultType)
  ) {
    retainOpaqueInterfaceResultOrigin(
      semantics,
      node,
      call.sourceResultType,
      ingress,
    );
  }
}
