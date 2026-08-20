import type { Node, Symbol } from "@tsonic/tsts";
import type { TargetSourceProgram } from "@tsonic/target-api";
import {
  KindIdentifier,
} from "@tsonic/tsts/target-ast";
import type { TargetProgramIndex } from "../../../program-index.js";
import type { ExactInvocationInputIndex } from "../invocation/inputs.js";
import { resolveProjectInvocation } from "../../model/project-invocation.js";

import {
  declarationForSymbols,
  indexDeclarationSymbols,
  isTransparentParent,
} from "../callable/input-reference.js";
import {
  callableDispatchIsClosed,
  isModuleForwardingReference,
} from "../../model/syntax.js";

export interface ReturnParameterBinding {
  readonly declaration: Node;
  readonly inputs: readonly Node[];
}

export interface ReturnParameterFlow {
  bindingFor(identifier: Node): ReturnParameterBinding | undefined;
}

export function createReturnParameterFlow(
  source: TargetSourceProgram,
  program: TargetProgramIndex,
  seedExpressions: readonly Node[],
  storageDeclarations: ReadonlySet<Node>,
  storageDeclarationFor: (expression: Node) => Node | undefined,
  invocationInputs: ExactInvocationInputIndex,
): ReturnParameterFlow {
  const parameters = collectReachableParameters(
    source,
    program,
    seedExpressions,
    invocationInputs,
  );
  const valid = auditParameterFlows(
    source,
    program,
    parameters,
    invocationInputs,
    storageDeclarations,
    storageDeclarationFor,
  );
  const bindings = new Map<Node, ReturnParameterBinding>();
  for (const parameter of valid) {
    const inputs = invocationInputs.inputsFor(parameter);
    if (inputs !== undefined && inputs.length !== 0) {
      bindings.set(parameter, Object.freeze({
        declaration: parameter,
        inputs: Object.freeze([...inputs]),
      }));
    }
  }
  return Object.freeze({
    bindingFor(identifier: Node): ReturnParameterBinding | undefined {
      if (!source.ast.is.IsIdentifier(identifier)) {
        return undefined;
      }
      const declaration = program.declarationReferenceFor(identifier)
        ?.declaration;
      return declaration === undefined ? undefined : bindings.get(declaration);
    },
  });
}

function collectReachableParameters(
  source: TargetSourceProgram,
  program: TargetProgramIndex,
  seeds: readonly Node[],
  invocationInputs: ExactInvocationInputIndex,
): ReadonlySet<Node> {
  const result = new Set<Node>();
  const pending = [...seeds];
  const visitedExpressions = new Set<Node>();
  while (pending.length !== 0) {
    const expression = pending.pop();
    if (expression === undefined || visitedExpressions.has(expression)) {
      continue;
    }
    visitedExpressions.add(expression);
    for (const parameter of referencedParameters(source, program, expression)) {
      if (result.has(parameter)) {
        continue;
      }
      result.add(parameter);
      for (const input of invocationInputs.inputsFor(parameter) ?? []) {
        pending.push(input);
      }
    }
  }
  return result;
}

function referencedParameters(
  source: TargetSourceProgram,
  program: TargetProgramIndex,
  expression: Node,
): readonly Node[] {
  const result = new Set<Node>();
  const pending = [expression];
  while (pending.length !== 0) {
    const node = pending.pop();
    if (node === undefined) {
      continue;
    }
    if (source.ast.is.IsIdentifier(node)) {
      const declaration = program.declarationReferenceFor(node)?.declaration;
      if (
        declaration !== undefined &&
        source.ast.is.IsParameterDeclaration(declaration)
      ) {
        result.add(declaration);
      }
    }
    for (const child of source.ast.children(node)) {
      if (child !== undefined) {
        pending.push(child);
      }
    }
  }
  return [...result];
}

function auditParameterFlows(
  source: TargetSourceProgram,
  program: TargetProgramIndex,
  parameters: ReadonlySet<Node>,
  invocationInputs: ExactInvocationInputIndex,
  storageDeclarations: ReadonlySet<Node>,
  storageDeclarationFor: (expression: Node) => Node | undefined,
): ReadonlySet<Node> {
  const valid = new Set(parameters);
  const owners = new Set<Node>();
  for (const parameter of parameters) {
    const owner = source.ast.parent(parameter);
    if (
      owner === undefined ||
      invocationInputs.isInvalid(parameter) ||
      !callableDispatchIsClosed(source, program, owner)
    ) {
      valid.delete(parameter);
    } else {
      owners.add(owner);
    }
  }
  auditOwnerReferences(source, program, owners, valid);
  const symbols = indexDeclarationSymbols(source, parameters);
  const destinations = new Map<Node, Set<Node>>();
  for (const node of program.nodesOfKind(KindIdentifier)) {
    const declaration = declarationForSymbols(source, symbols, node);
    if (
      declaration === undefined ||
      !valid.has(declaration) ||
      node === source.ast.name(declaration) ||
      isModuleForwardingReference(source, node)
    ) {
      continue;
    }
    const selectedDestinations = transportDestinations(
      source,
      node,
      parameters,
      storageDeclarations,
      storageDeclarationFor,
      invocationInputs,
    );
    if (
      selectedDestinations === undefined ||
      selectedDestinations.some((destination) =>
        !valid.has(destination) && !storageDeclarations.has(destination)
      )
    ) {
      valid.delete(declaration);
    } else {
      for (const destination of selectedDestinations) {
        if (parameters.has(destination)) {
          appendSet(destinations, declaration, destination);
        }
      }
    }
  }
  closeInvalidParameters(parameters, valid, destinations);
  return valid;
}

function closeInvalidParameters(
  parameters: ReadonlySet<Node>,
  valid: Set<Node>,
  destinations: ReadonlyMap<Node, ReadonlySet<Node>>,
): void {
  const dependents = new Map<Node, Set<Node>>();
  for (const [parameter, nextParameters] of destinations) {
    for (const destination of nextParameters) {
      appendSet(dependents, destination, parameter);
    }
  }
  const pending = [...parameters].filter((parameter) => !valid.has(parameter));
  while (pending.length !== 0) {
    const destination = pending.pop();
    if (destination === undefined) {
      continue;
    }
    for (const parameter of dependents.get(destination) ?? []) {
      if (valid.delete(parameter)) {
        pending.push(parameter);
      }
    }
  }
}

function auditOwnerReferences(
  source: TargetSourceProgram,
  program: TargetProgramIndex,
  owners: ReadonlySet<Node>,
  validParameters: Set<Node>,
): void {
  const symbols = indexDeclarationSymbols(source, owners);
  for (const node of program.nodesOfKind(KindIdentifier)) {
    const owner = declarationForSymbols(source, symbols, node);
    if (
      owner === undefined ||
      node === source.ast.name(owner) ||
      isModuleForwardingReference(source, node) ||
      isDirectInvocationTarget(source, node, owner)
    ) {
      continue;
    }
    for (const parameter of source.ast.parameters(owner)) {
      if (parameter !== undefined) {
        validParameters.delete(parameter);
      }
    }
  }
}

function isDirectInvocationTarget(
  source: TargetSourceProgram,
  reference: Node,
  declaration: Node,
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
    if (source.ast.is.IsPropertyAccessExpression(parent)) {
      if (source.ast.as.AsPropertyAccessExpression(parent)?.name !== current) {
        return false;
      }
      current = parent;
      continue;
    }
    if (!source.ast.is.IsCallExpression(parent) && !source.ast.is.IsNewExpression(parent)) {
      return false;
    }
    const callable = source.ast.is.IsCallExpression(parent)
      ? source.ast.as.AsCallExpression(parent)?.Expression
      : source.ast.as.AsNewExpression(parent)?.Expression;
    if (callable !== current) {
      return false;
    }
    return resolveProjectInvocation(source, parent)?.implementation === declaration;
  }
}

function transportDestinations(
  source: TargetSourceProgram,
  reference: Node,
  parameters: ReadonlySet<Node>,
  storageDeclarations: ReadonlySet<Node>,
  storageDeclarationFor: (expression: Node) => Node | undefined,
  invocationInputs: ExactInvocationInputIndex,
): readonly Node[] | undefined {
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
    if (source.ast.is.IsBinaryExpression(parent)) {
      const binary = source.ast.as.AsBinaryExpression(parent);
      const destination = binary?.Right === current &&
          source.ast.operatorKindName(parent) === "KindEqualsToken" &&
          binary.Left !== undefined
        ? storageDeclarationFor(binary.Left)
        : undefined;
      return destination === undefined ? undefined : [destination];
    }
    if (!source.ast.is.IsCallExpression(parent) && !source.ast.is.IsNewExpression(parent)) {
      return undefined;
    }
    const destinations = invocationInputs.parametersFor(current);
    return destinations !== undefined && destinations.length !== 0 &&
        destinations.every((destination) =>
          parameters.has(destination) || storageDeclarations.has(destination)
        )
      ? destinations
      : undefined;
  }
}

function appendSet(target: Map<Node, Set<Node>>, key: Node, value: Node): void {
  const values = target.get(key);
  if (values === undefined) {
    target.set(key, new Set([value]));
  } else {
    values.add(value);
  }
}
