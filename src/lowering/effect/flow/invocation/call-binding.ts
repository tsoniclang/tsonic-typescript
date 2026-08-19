import type { Node } from "@tsonic/tsts";
import type {
  ResolvedSourceCallInfo,
  TargetSourceProgram,
} from "@tsonic/target-api";

import { resolveProjectInvocation } from "../../model/project-invocation.js";

type SourceArgumentBinding =
  ResolvedSourceCallInfo["sourceArgumentBindings"][number];

export interface ExactSourceCallParameterBinding {
  readonly argument: Node;
  readonly parameter: Node;
  readonly evidence: SourceArgumentBinding;
}

export interface ExactSourceCallBindings {
  readonly call: ResolvedSourceCallInfo;
  readonly declaration: Node;
  readonly bindings: readonly ExactSourceCallParameterBinding[];
  readonly unboundParameters: readonly Node[];
}

export interface ExactSourceCallImplementationInputs {
  readonly call: ResolvedSourceCallInfo;
  readonly contract: Node;
  readonly declaration: Node;
  readonly inputs: ReadonlyMap<Node, Node>;
  readonly unresolvedParameters: readonly Node[];
}

export function exactSourceCallImplementationInputs(
  source: TargetSourceProgram,
  node: Node,
): ExactSourceCallImplementationInputs | undefined {
  const invocation = exactSourceCallBindings(source, node);
  if (invocation === undefined) {
    return undefined;
  }
  const target = resolveProjectInvocation(source, node);
  if (
    target === undefined ||
    target.call !== invocation.call ||
    target.contract !== invocation.declaration
  ) {
    return undefined;
  }
  const inputs = exactSourceCallInputsForDeclaration(
    source,
    node,
    target.implementation,
  );
  if (inputs === undefined) {
    return undefined;
  }
  const parameters = source.ast.parameters(target.implementation).filter(
    (parameter): parameter is Node => parameter !== undefined,
  );
  return Object.freeze({
    call: invocation.call,
    contract: invocation.declaration,
    declaration: target.implementation,
    inputs,
    unresolvedParameters: Object.freeze(
      parameters.filter((parameter) => !inputs.has(parameter)),
    ),
  });
}

export function exactSourceCallInputsForDeclaration(
  source: TargetSourceProgram,
  node: Node,
  declaration: Node,
): ReadonlyMap<Node, Node> | undefined {
  const invocation = exactSourceCallBindings(source, node);
  if (invocation === undefined) {
    return undefined;
  }
  const parameterSlots = source.ast.parameters(declaration);
  if (parameterSlots.some((parameter) => parameter === undefined)) {
    return undefined;
  }
  const parameters = parameterSlots.filter(
    (parameter): parameter is Node => parameter !== undefined,
  );
  const effectiveArguments = new Map<number, Node>();
  for (const { argument, evidence } of invocation.bindings) {
    if (
      evidence.sourceForm !== "value" ||
      effectiveArguments.has(evidence.effectiveArgumentIndex)
    ) {
      return undefined;
    }
    effectiveArguments.set(evidence.effectiveArgumentIndex, argument);
  }
  return new Map(parameters.flatMap((parameter, index) => {
    const rest = source.ast.as.AsParameterDeclaration(parameter)
      ?.DotDotDotToken !== undefined;
    const argument = rest ? undefined : effectiveArguments.get(index);
    return argument === undefined ? [] : [[parameter, argument] as const];
  }));
}

export function exactSourceCallBindings(
  source: TargetSourceProgram,
  node: Node,
): ExactSourceCallBindings | undefined {
  if (
    !source.ast.is.IsCallExpression(node) &&
    !source.ast.is.IsNewExpression(node)
  ) {
    return undefined;
  }
  const semantics = source.semantics.forNode(node);
  const call = semantics.getResolvedCallInfo(node);
  const declaration = call === undefined
    ? undefined
    : semantics.getSignatureDeclaration(call.selectedSignature);
  if (
    call === undefined ||
    declaration === undefined ||
    !callHasExactBindings(source, node, call, declaration)
  ) {
    return undefined;
  }
  const parameterSlots = source.ast.parameters(declaration);
  if (parameterSlots.some((parameter) => parameter === undefined)) {
    return undefined;
  }
  const parameters = parameterSlots.filter(
    (parameter): parameter is Node => parameter !== undefined,
  );
  if (
    call.sourceSelectedSignatureParameters.length !== parameters.length ||
    call.sourceSelectedSignatureParameters.some((selected, index) =>
      selected.parameterDeclaration !== parameters[index]
    )
  ) {
    return undefined;
  }
  const bindings: ExactSourceCallParameterBinding[] = [];
  const boundParameters = new Set<Node>();
  for (const evidence of call.sourceArgumentBindings) {
    const argument = call.sourceArguments[evidence.sourceArgumentIndex]
      ?.expression;
    const parameter = call.sourceSelectedSignatureParameters[
      evidence.sourceParameterIndex
    ]?.parameterDeclaration;
    if (argument === undefined || parameter === undefined) {
      return undefined;
    }
    bindings.push(Object.freeze({ argument, parameter, evidence }));
    boundParameters.add(parameter);
  }
  return Object.freeze({
    call,
    declaration,
    bindings: Object.freeze(bindings),
    unboundParameters: Object.freeze(
      parameters.filter((parameter) => !boundParameters.has(parameter)),
    ),
  });
}

export function callHasExactBindings(
  source: TargetSourceProgram,
  node: Node,
  call: ResolvedSourceCallInfo,
  declaration: Node | undefined,
): boolean {
  const authoredArguments = source.ast.arguments(node);
  if (
    declaration === undefined ||
    call.call !== node ||
    call.outcome !== "applicable" ||
    call.sourceSelectedSignatureKind !== "resolved" ||
    call.sourceArguments.length !== authoredArguments.length ||
    call.sourceSelectedSignatureParameters.some((parameter, index) =>
      parameter.parameterIndex !== index ||
      (parameter.rest && index !==
        call.sourceSelectedSignatureParameters.length - 1)
    )
  ) {
    return false;
  }
  const boundArguments = new Set<number>();
  const effectiveArguments = new Set<number>();
  const sourceBindings = new Map<number, SourceArgumentBinding[]>();
  let previousSourceArgument = -1;
  for (const [bindingIndex, binding] of call.sourceArgumentBindings.entries()) {
    const parameter = call.sourceSelectedSignatureParameters[
      binding.sourceParameterIndex
    ];
    const sourceArgument = call.sourceArguments[binding.sourceArgumentIndex];
    const authoredArgument = authoredArguments[binding.sourceArgumentIndex];
    if (
      !Number.isSafeInteger(binding.sourceArgumentIndex) ||
      !Number.isSafeInteger(binding.effectiveArgumentIndex) ||
      !Number.isSafeInteger(binding.sourceParameterIndex) ||
      binding.sourceArgumentIndex < 0 ||
      binding.sourceArgumentIndex < previousSourceArgument ||
      binding.effectiveArgumentIndex !== bindingIndex ||
      effectiveArguments.has(binding.effectiveArgumentIndex) ||
      parameter === undefined ||
      parameter.parameterIndex !== binding.sourceParameterIndex ||
      sourceArgument?.expression !== authoredArgument ||
      authoredArgument === undefined ||
      source.ast.is.IsSpreadElement(authoredArgument) !==
        (binding.sourceForm !== "value") ||
      !bindingFormsAgree(binding, parameter.rest) ||
      !parameterPositionAgrees(binding, parameter.rest)
    ) {
      return false;
    }
    previousSourceArgument = binding.sourceArgumentIndex;
    boundArguments.add(binding.sourceArgumentIndex);
    effectiveArguments.add(binding.effectiveArgumentIndex);
    const bindings = sourceBindings.get(binding.sourceArgumentIndex);
    if (bindings === undefined) {
      sourceBindings.set(binding.sourceArgumentIndex, [binding]);
    } else {
      bindings.push(binding);
    }
  }
  return boundArguments.size === call.sourceArguments.length &&
    [...effectiveArguments].every((index) => index < effectiveArguments.size) &&
    [...sourceBindings.values()].every(sourceBindingsAreExact);
}

function bindingFormsAgree(
  binding: SourceArgumentBinding,
  rest: boolean,
): boolean {
  if (binding.sourceForm === "value") {
    return binding.spreadElementIndex === undefined &&
      binding.sourceParameterForm === (rest ? "rest-element" : "parameter");
  }
  if (binding.sourceForm === "spread-element") {
    return binding.sourceParameterForm ===
        (rest ? "rest-element" : "parameter") &&
      Number.isSafeInteger(binding.spreadElementIndex) &&
      (binding.spreadElementIndex ?? -1) >= 0;
  }
  return rest && binding.sourceParameterForm === "rest-sequence" &&
    (
      binding.spreadElementIndex === undefined ||
      (
        Number.isSafeInteger(binding.spreadElementIndex) &&
        binding.spreadElementIndex >= 0
      )
    );
}

function parameterPositionAgrees(
  binding: SourceArgumentBinding,
  rest: boolean,
): boolean {
  return rest
    ? binding.effectiveArgumentIndex >= binding.sourceParameterIndex
    : binding.effectiveArgumentIndex === binding.sourceParameterIndex;
}

function sourceBindingsAreExact(
  bindings: readonly SourceArgumentBinding[],
): boolean {
  if (bindings.length === 0) {
    return false;
  }
  if (bindings[0]?.sourceForm === "value") {
    return bindings.length === 1;
  }
  let nextElementIndex = 0;
  let sequenceSeen = false;
  for (const binding of bindings) {
    if (sequenceSeen || binding.sourceForm === "value") {
      return false;
    }
    if (binding.sourceForm === "spread-sequence") {
      sequenceSeen = true;
      if (
        binding.spreadElementIndex !== undefined &&
        binding.spreadElementIndex !== nextElementIndex
      ) {
        return false;
      }
      continue;
    }
    if (binding.spreadElementIndex !== nextElementIndex) {
      return false;
    }
    nextElementIndex += 1;
  }
  return true;
}
