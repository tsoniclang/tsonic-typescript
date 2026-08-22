import type { Node } from "@tsonic/tsts";
import type {
  ResolvedSourceCallInfo,
  TargetSourceProgram,
} from "@tsonic/target-api/source";

import { resolveProjectInvocation } from "../../model/project-invocation.js";
import type { ExactAggregateProjectionIndex } from "../aggregate/projection.js";
import { sameValueAlternatives } from "../value/alternatives.js";

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
  readonly inputs: ReadonlyMap<Node, readonly Node[]>;
  readonly unresolvedParameters: readonly Node[];
}

export interface ExactSourceCallResolvedInputs {
  readonly inputs: ReadonlyMap<Node, readonly Node[]>;
  readonly unresolvedParameters: readonly Node[];
}

export function exactSourceCallImplementationInputs(
  source: TargetSourceProgram,
  node: Node,
  projections?: ExactAggregateProjectionIndex,
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
  const resolvedInputs = exactSourceCallInputsForDeclaration(
    source,
    node,
    target.implementation,
    projections,
  );
  if (resolvedInputs === undefined) {
    return undefined;
  }
  return Object.freeze({
    call: invocation.call,
    contract: invocation.declaration,
    declaration: target.implementation,
    inputs: resolvedInputs.inputs,
    unresolvedParameters: resolvedInputs.unresolvedParameters,
  });
}

export function exactSourceCallInputsForDeclaration(
  source: TargetSourceProgram,
  node: Node,
  declaration: Node,
  projections?: ExactAggregateProjectionIndex,
): ExactSourceCallResolvedInputs | undefined {
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
  if (
    parameters.length !== invocation.call.sourceSelectedSignatureParameters.length ||
    parameters.some((parameter, index) => {
      const selected = invocation.call.sourceSelectedSignatureParameters[index];
      const rest = source.ast.as.AsParameterDeclaration(parameter)
        ?.DotDotDotToken !== undefined;
      return selected === undefined || selected.parameterIndex !== index ||
        selected.rest !== rest;
    })
  ) {
    return undefined;
  }
  const effectiveArguments = new Map<
    number,
    ExactSourceCallParameterBinding
  >();
  for (const binding of invocation.bindings) {
    const { evidence } = binding;
    if (
      effectiveArguments.has(evidence.effectiveArgumentIndex)
    ) {
      return undefined;
    }
    effectiveArguments.set(evidence.effectiveArgumentIndex, binding);
  }
  const inputs = new Map<Node, readonly Node[]>();
  const unresolved: Node[] = [];
  for (const [index, parameter] of parameters.entries()) {
    const parsed = source.ast.as.AsParameterDeclaration(parameter);
    const rest = parsed?.DotDotDotToken !== undefined;
    const selected = rest
      ? [...effectiveArguments]
        .filter(([argumentIndex]) => argumentIndex >= index)
        .map(([, binding]) => binding)
      : [effectiveArguments.get(index)].filter(
        (binding): binding is ExactSourceCallParameterBinding =>
          binding !== undefined,
      );
    if (selected.length === 0) {
      if (parsed?.Initializer !== undefined) {
        inputs.set(parameter, Object.freeze([parsed.Initializer]));
      } else if (rest || parsed?.QuestionToken !== undefined) {
        inputs.set(parameter, Object.freeze([]));
      } else {
        unresolved.push(parameter);
      }
      continue;
    }
    const values = selected.map((binding) =>
      exactSourceCallBindingInputs(
        source,
        binding.argument,
        binding.evidence,
        projections,
      )
    );
    if (values.some((value) => value === undefined)) {
      unresolved.push(parameter);
      continue;
    }
    inputs.set(parameter, Object.freeze([
      ...new Set(values.flatMap((value) => value ?? [])),
      ...(parsed?.Initializer === undefined ? [] : [parsed.Initializer]),
    ]));
  }
  return Object.freeze({
    inputs,
    unresolvedParameters: Object.freeze(unresolved),
  });
}

export function exactSourceCallBindingInput(
  source: TargetSourceProgram,
  argument: Node,
  evidence: SourceArgumentBinding,
  projections?: ExactAggregateProjectionIndex,
): Node | undefined {
  const inputs = exactSourceCallBindingInputs(
    source,
    argument,
    evidence,
    projections,
  );
  return inputs?.length === 1 ? inputs[0] : undefined;
}

export function exactSourceCallBindingInputs(
  source: TargetSourceProgram,
  argument: Node,
  evidence: SourceArgumentBinding,
  projections?: ExactAggregateProjectionIndex,
): readonly Node[] | undefined {
  if (evidence.sourceForm === "value") {
    return Object.freeze([argument]);
  }
  if (
    evidence.sourceForm !== "spread-element" &&
    evidence.sourceForm !== "spread-sequence"
  ) {
    return undefined;
  }
  const spread = source.ast.as.AsSpreadElement(argument)?.Expression;
  const root = transparentSourceExpression(source, spread);
  const projected = root === undefined
    ? undefined
    : projections?.sourceForReference(root)?.aggregate;
  const aggregate = projected ?? root;
  const alternatives = aggregate === undefined
    ? undefined
    : exactAggregateElements(source, aggregate, projections);
  if (alternatives === undefined || alternatives.length === 0) {
    return undefined;
  }
  const start = evidence.spreadElementIndex ?? 0;
  const selected = alternatives.flatMap((elements) =>
    evidence.sourceForm === "spread-element"
      ? [elements[start]]
      : elements.slice(start)
  );
  if (selected.length === 0) {
    return evidence.sourceForm === "spread-sequence"
      ? Object.freeze([])
      : undefined;
  }
  return selected.some((element) =>
      element === undefined || source.ast.is.IsSpreadElement(element)
    )
    ? undefined
    : Object.freeze(selected.filter((element): element is Node =>
      element !== undefined
    ));
}

function exactAggregateElements(
  source: TargetSourceProgram,
  expression: Node,
  projections: ExactAggregateProjectionIndex | undefined,
  seen: ReadonlySet<Node> = new Set(),
): readonly (readonly (Node | undefined)[])[] | undefined {
  const root = transparentSourceExpression(source, expression);
  if (root === undefined || seen.has(root)) {
    return undefined;
  }
  if (source.ast.is.IsArrayLiteralExpression(root)) {
    const elements = source.ast.elements(root);
    return elements.some((element) =>
        element === undefined || source.ast.is.IsSpreadElement(element)
      )
      ? undefined
      : Object.freeze([Object.freeze([...elements])]);
  }
  if (source.ast.is.IsAwaitExpression(root)) {
    const awaited = source.ast.as.AsAwaitExpression(root)?.Expression;
    return awaited === undefined
      ? undefined
      : exactAggregateElements(
          source,
          awaited,
          projections,
          new Set([...seen, root]),
        );
  }
  if (source.ast.is.IsIdentifier(root)) {
    const projected = projections?.sourceForReference(root)?.aggregate;
    if (projected !== undefined && projected !== root) {
      return exactAggregateElements(
        source,
        projected,
        projections,
        new Set([...seen, root]),
      );
    }
  }
  const branches = sameValueAlternatives(source, root);
  if (branches === undefined || branches === null || branches.length === 0) {
    return undefined;
  }
  const result: (readonly (Node | undefined)[])[] = [];
  const nextSeen = new Set([...seen, root]);
  for (const branch of branches) {
    const selected = exactAggregateElements(
      source,
      branch,
      projections,
      nextSeen,
    );
    if (selected === undefined) {
      return undefined;
    }
    result.push(...selected);
  }
  const length = result[0]?.length;
  return length === undefined || result.some((elements) =>
      elements.length !== length
    )
    ? undefined
    : Object.freeze(result);
}

function transparentSourceExpression(
  source: TargetSourceProgram,
  expression: Node | undefined,
): Node | undefined {
  let current = expression;
  for (;;) {
    if (current === undefined) {
      return undefined;
    }
    if (source.ast.is.IsParenthesizedExpression(current)) {
      current = source.ast.as.AsParenthesizedExpression(current)?.Expression;
      continue;
    }
    if (source.ast.is.IsAsExpression(current)) {
      current = source.ast.as.AsAsExpression(current)?.Expression;
      continue;
    }
    if (source.ast.is.IsTypeAssertion(current)) {
      current = source.ast.as.AsTypeAssertion(current)?.Expression;
      continue;
    }
    if (source.ast.is.IsSatisfiesExpression(current)) {
      current = source.ast.as.AsSatisfiesExpression(current)?.Expression;
      continue;
    }
    return current;
  }
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
  const call = semantics.operations.call(node);
  const declaration = call === undefined
    ? undefined
    : semantics.declarations.signatureDeclaration(call.selectedSignature);
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
