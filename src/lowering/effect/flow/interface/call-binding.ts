import type { Node } from "@tsonic/tsts";
import type {
  ResolvedSourceCallInfo,
  TargetSourceProgram,
} from "@tsonic/target-api";

type SourceArgumentBinding =
  ResolvedSourceCallInfo["sourceArgumentBindings"][number];

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
