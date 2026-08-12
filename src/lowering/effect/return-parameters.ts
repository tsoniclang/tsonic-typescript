import type { Node, Symbol } from "@tsonic/tsts";
import type { TargetSourceProgram } from "@tsonic/target-api";
import {
  KindCallExpression,
  KindIdentifier,
  KindNewExpression,
} from "@tsonic/tsts/target-ast";
import type { TargetProgramIndex } from "../program-index.js";

import {
  declarationForSymbols,
  indexDeclarationSymbols,
  isTransparentParent,
} from "./callable-input-reference.js";
import {
  callableDispatchIsClosed,
  isModuleForwardingReference,
} from "./syntax.js";

export interface ReturnParameterBinding {
  readonly declaration: Node;
  readonly inputs: readonly Node[];
}

export interface ReturnParameterFlow {
  bindingFor(identifier: Node): ReturnParameterBinding | undefined;
}

interface InvocationInputs {
  readonly values: Map<Node, Node[]>;
  readonly invalidOwners: Set<Node>;
}

export function createReturnParameterFlow(
  source: TargetSourceProgram,
  program: TargetProgramIndex,
  seedExpressions: readonly Node[],
  storageDeclarations: ReadonlySet<Node>,
  storageDeclarationFor: (expression: Node) => Node | undefined,
): ReturnParameterFlow {
  const invocationInputs = collectInvocationInputs(source, program);
  const parameters = collectReachableParameters(
    source,
    seedExpressions,
    invocationInputs,
  );
  const valid = auditParameterFlows(
    source,
    program,
    parameters,
    invocationInputs.invalidOwners,
    storageDeclarations,
    storageDeclarationFor,
  );
  const bindings = new Map<Node, ReturnParameterBinding>();
  for (const parameter of valid) {
    const inputs = invocationInputs.values.get(parameter);
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
      const declaration = source.navigation.sourceReferenceFor(identifier)
        ?.declaration;
      return declaration === undefined ? undefined : bindings.get(declaration);
    },
  });
}

function collectInvocationInputs(
  source: TargetSourceProgram,
  program: TargetProgramIndex,
): InvocationInputs {
  const values = new Map<Node, Node[]>();
  const invalidOwners = new Set<Node>();
  for (const node of program.nodesOfKinds([
    KindCallExpression,
    KindNewExpression,
  ])) {
    const semantics = source.semantics.forNode(node);
    const owner = semantics.getSignatureDeclaration(
      semantics.getResolvedSignature(node),
    );
    if (owner === undefined) {
      continue;
    }
    const parameters = source.ast.parameters(owner);
    const arguments_ = source.ast.arguments(node);
    if (
      arguments_.some((argument) => source.ast.is.IsSpreadElement(argument)) ||
      parameters.some((parameter) =>
        source.ast.as.AsParameterDeclaration(parameter)?.DotDotDotToken !== undefined
      )
    ) {
      invalidOwners.add(owner);
      continue;
    }
    for (let index = 0; index < parameters.length; index += 1) {
      const parameter = parameters[index];
      const argument = arguments_[index];
      if (parameter === undefined) {
        continue;
      }
      if (argument === undefined) {
        invalidOwners.add(owner);
      } else {
        append(values, parameter, argument);
      }
    }
  }
  return { values, invalidOwners };
}

function collectReachableParameters(
  source: TargetSourceProgram,
  seeds: readonly Node[],
  invocationInputs: InvocationInputs,
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
    for (const parameter of referencedParameters(source, expression)) {
      if (result.has(parameter)) {
        continue;
      }
      result.add(parameter);
      for (const input of invocationInputs.values.get(parameter) ?? []) {
        pending.push(input);
      }
    }
  }
  return result;
}

function referencedParameters(
  source: TargetSourceProgram,
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
      const declaration = source.navigation.sourceReferenceFor(node)?.declaration;
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
  invalidOwners: ReadonlySet<Node>,
  storageDeclarations: ReadonlySet<Node>,
  storageDeclarationFor: (expression: Node) => Node | undefined,
): ReadonlySet<Node> {
  const valid = new Set(parameters);
  const owners = new Set<Node>();
  for (const parameter of parameters) {
    const owner = source.ast.parent(parameter);
    if (
      owner === undefined ||
      invalidOwners.has(owner) ||
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
    const destination = transportDestination(
      source,
      node,
      parameters,
      storageDeclarations,
      storageDeclarationFor,
    );
    if (destination === undefined || !valid.has(destination) &&
      !storageDeclarations.has(destination)) {
      valid.delete(declaration);
    } else if (parameters.has(destination)) {
      appendSet(destinations, declaration, destination);
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
    const semantics = source.semantics.forNode(parent);
    return semantics.getSignatureDeclaration(
      semantics.getResolvedSignature(parent),
    ) === declaration;
  }
}

function transportDestination(
  source: TargetSourceProgram,
  reference: Node,
  parameters: ReadonlySet<Node>,
  storageDeclarations: ReadonlySet<Node>,
  storageDeclarationFor: (expression: Node) => Node | undefined,
): Node | undefined {
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
      return binary?.Right === current &&
          source.ast.operatorKindName(parent) === "KindEqualsToken" &&
          binary.Left !== undefined
        ? storageDeclarationFor(binary.Left)
        : undefined;
    }
    if (!source.ast.is.IsCallExpression(parent) && !source.ast.is.IsNewExpression(parent)) {
      return undefined;
    }
    const arguments_ = source.ast.arguments(parent);
    const index = arguments_.indexOf(current);
    if (index < 0) {
      return undefined;
    }
    const semantics = source.semantics.forNode(parent);
    const owner = semantics.getSignatureDeclaration(
      semantics.getResolvedSignature(parent),
    );
    const destination = owner === undefined
      ? undefined
      : source.ast.parameters(owner)[index];
    return destination !== undefined &&
        (parameters.has(destination) || storageDeclarations.has(destination))
      ? destination
      : undefined;
  }
}

function append(target: Map<Node, Node[]>, key: Node, value: Node): void {
  const values = target.get(key);
  if (values === undefined) {
    target.set(key, [value]);
  } else {
    values.push(value);
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
