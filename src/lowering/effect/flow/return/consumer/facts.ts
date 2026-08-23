import type { Node } from "@tsonic/tsts";
import type { TargetSourceProgram } from "@tsonic/target-api/source";
import {
  KindCallExpression,
  KindElementAccessExpression,
  KindIdentifier,
  KindPropertyAccessExpression,
} from "@tsonic/tsts/target-ast";

import type { TargetProgramIndex } from "../../../../program-index.js";
import type { InvocationTransportContract } from "../../../../invocation-transport.js";
import type { EffectProvenanceVertexKind } from "../../../provenance/model.js";
import type { ExactAggregateProjectionIndex } from "../../aggregate/projection.js";
import { createExactValueSlotFlow } from "../../value/slot/flow.js";
import type { ExactValueSlotCallSource } from "../../value/slot/model.js";
import { exactCallableReturnExpressions } from "../../invocation/results.js";
import type { ExactInvocationInputIndex } from "../../invocation/inputs.js";
import {
  callableDispatchIsClosed,
  isFunctionLike,
} from "../../../model/syntax.js";
import { resolveProjectInvocation } from "../../../model/project-invocation.js";
import { declarationIsExported } from "../../../model/declaration-surface.js";
import {
  storageDeclarationCanBeTracked,
} from "../../storage/owners.js";

export function resultConsumerBindingKind(
  source: TargetSourceProgram,
  declaration: Node,
): EffectProvenanceVertexKind {
  return source.ast.is.IsParameterDeclaration(declaration)
    ? "parameter"
    : source.ast.is.IsPropertyDeclaration(declaration)
    ? "storage"
    : "binding";
}

export function resultConsumerBindingIsClosed(
  source: TargetSourceProgram,
  declaration: Node,
  closedStorageOwners: ReadonlySet<Node>,
): boolean {
  if (
    source.ast.is.IsVariableDeclaration(declaration) ||
    source.ast.is.IsBindingElement(declaration) ||
    source.ast.is.IsParameterDeclaration(declaration) &&
      !storageDeclarationCanBeTracked(source, declaration)
  ) {
    return source.ast.is.IsIdentifier(source.ast.name(declaration)) &&
      !declarationIsExported(source, declaration);
  }
  if (!storageDeclarationCanBeTracked(source, declaration)) {
    return false;
  }
  const owner = storageOwner(source, declaration);
  return owner !== undefined && closedStorageOwners.has(owner);
}

export function exactResultConsumerBindingPattern(
  source: TargetSourceProgram,
  declaration: Node,
): readonly Node[] | undefined {
  const name = source.ast.name(declaration);
  if (
    name === undefined ||
    (!source.ast.is.IsArrayBindingPattern(name) &&
      !source.ast.is.IsObjectBindingPattern(name))
  ) {
    return undefined;
  }
  const bindings: Node[] = [];
  if (!collectResultBindingPattern(source, name, bindings)) {
    return undefined;
  }
  return Object.freeze(bindings);
}

function collectResultBindingPattern(
  source: TargetSourceProgram,
  pattern: Node,
  bindings: Node[],
): boolean {
  for (const element of source.ast.elements(pattern)) {
    if (element === undefined) {
      return false;
    }
    if (source.ast.is.IsOmittedExpression(element)) {
      continue;
    }
    if (!source.ast.is.IsBindingElement(element)) {
      return false;
    }
    const name = source.ast.name(element);
    if (name === undefined) {
      return false;
    }
    if (source.ast.is.IsIdentifier(name)) {
      bindings.push(element);
      continue;
    }
    if (
      (!source.ast.is.IsArrayBindingPattern(name) &&
        !source.ast.is.IsObjectBindingPattern(name)) ||
      !collectResultBindingPattern(source, name, bindings)
    ) {
      return false;
    }
  }
  return true;
}

export function selectedResultConsumerBinding(
  source: TargetSourceProgram,
  expression: Node,
): Node | undefined {
  if (source.ast.is.IsIdentifier(expression)) {
    const reference = source.navigation.sourceReferenceFor(expression);
    return reference?.project === true ? reference.declaration : undefined;
  }
  const selected = source.ast.is.IsPropertyAccessExpression(expression)
    ? source.semantics.forNode(expression)
      .operations.propertyAccess(expression)?.selectedDeclaration
    : source.ast.is.IsElementAccessExpression(expression)
    ? source.semantics.forNode(expression)
      .operations.elementAccess(expression)?.selectedDeclaration
    : undefined;
  return selected !== undefined && source.navigation.isProjectDeclaration(selected)
    ? selected
    : undefined;
}

export function exactResultConsumerAssignmentBindings(
  source: TargetSourceProgram,
  expression: Node,
): readonly Node[] | undefined {
  if (
    !source.ast.is.IsArrayLiteralExpression(expression) &&
    !source.ast.is.IsObjectLiteralExpression(expression)
  ) {
    const selected = selectedResultConsumerBinding(source, expression);
    return selected === undefined ? undefined : Object.freeze([selected]);
  }
  const result: Node[] = [];
  return collectResultAssignmentBindings(source, expression, result)
    ? Object.freeze(result)
    : undefined;
}

function collectResultAssignmentBindings(
  source: TargetSourceProgram,
  expression: Node,
  result: Node[],
): boolean {
  const elements = source.ast.is.IsArrayLiteralExpression(expression)
    ? source.ast.elements(expression)
    : source.ast.properties(expression);
  for (const element of elements) {
    if (element === undefined || source.ast.is.IsSpreadElement(element)) {
      return false;
    }
    if (source.ast.is.IsOmittedExpression(element)) {
      continue;
    }
    const value = source.ast.is.IsPropertyAssignment(element)
      ? source.ast.as.AsPropertyAssignment(element)?.Initializer
      : source.ast.is.IsShorthandPropertyAssignment(element)
      ? source.ast.name(element)
      : source.ast.is.IsSpreadAssignment(element)
      ? source.ast.as.AsSpreadAssignment(element)?.Expression
      : element;
    if (value === undefined) {
      return false;
    }
    if (
      source.ast.is.IsArrayLiteralExpression(value) ||
      source.ast.is.IsObjectLiteralExpression(value)
    ) {
      if (!collectResultAssignmentBindings(source, value, result)) {
        return false;
      }
      continue;
    }
    const selected = selectedResultConsumerBinding(source, value);
    if (selected === undefined) {
      return false;
    }
    result.push(selected);
  }
  return true;
}

export function resultConsumerDeclarationInitializer(
  source: TargetSourceProgram,
  declaration: Node,
): Node | undefined {
  return source.ast.is.IsPropertyDeclaration(declaration)
    ? source.ast.as.AsPropertyDeclaration(declaration)?.Initializer
    : source.ast.is.IsParameterDeclaration(declaration)
    ? source.ast.as.AsParameterDeclaration(declaration)?.Initializer
    : undefined;
}

export function resultConsumerProjectionReceiver(
  source: TargetSourceProgram,
  expression: Node,
): Node | undefined {
  return source.ast.is.IsPropertyAccessExpression(expression)
    ? source.ast.as.AsPropertyAccessExpression(expression)?.Expression
    : source.ast.is.IsElementAccessExpression(expression)
    ? source.ast.as.AsElementAccessExpression(expression)?.Expression
    : undefined;
}

export function isTransparentResultConsumerParent(
  source: TargetSourceProgram,
  parent: Node,
  child: Node,
): boolean {
  return source.ast.is.IsParenthesizedExpression(parent)
      && source.ast.as.AsParenthesizedExpression(parent)?.Expression === child ||
    source.ast.is.IsAsExpression(parent)
      && source.ast.as.AsAsExpression(parent)?.Expression === child ||
    source.ast.is.IsTypeAssertion(parent)
      && source.ast.as.AsTypeAssertion(parent)?.Expression === child ||
    source.ast.is.IsSatisfiesExpression(parent)
      && source.ast.as.AsSatisfiesExpression(parent)?.Expression === child ||
    source.ast.is.IsNonNullExpression(parent)
      && source.ast.as.AsNonNullExpression(parent)?.Expression === child;
}

export function containingResultConsumerFunction(
  source: TargetSourceProgram,
  node: Node,
): Node | undefined {
  let current = source.ast.parent(node);
  while (current !== undefined) {
    if (isFunctionLike(source, current)) {
      return current;
    }
    current = source.ast.parent(current);
  }
  return undefined;
}

export function isInspectableResultForwarder(
  source: TargetSourceProgram,
  program: TargetProgramIndex,
  declaration: Node,
): boolean {
  if (source.ast.body(declaration) === undefined) {
    return false;
  }
  if (
    declarationIsExported(source, declaration) ||
    !callableDispatchIsClosed(source, program, declaration)
  ) {
    return false;
  }
  if (source.ast.is.IsFunctionDeclaration(declaration)) {
    return source.ast.as.AsFunctionDeclaration(declaration)?.AsteriskToken ===
      undefined;
  }
  if (source.ast.is.IsFunctionExpression(declaration)) {
    return source.ast.as.AsFunctionExpression(declaration)?.AsteriskToken ===
      undefined;
  }
  if (source.ast.is.IsMethodDeclaration(declaration)) {
    return source.ast.as.AsMethodDeclaration(declaration)?.AsteriskToken ===
      undefined;
  }
  return source.ast.is.IsArrowFunction(declaration);
}

export function indexResultConsumerCalls(
  source: TargetSourceProgram,
  program: TargetProgramIndex,
  exactCallImplementations?: (call: Node) => readonly Node[] | undefined,
): ReadonlyMap<Node, readonly Node[]> {
  const mutable = new Map<Node, Node[]>();
  for (const call of program.nodesOfKind(KindCallExpression)) {
    const direct = resolveProjectInvocation(source, call)?.implementation;
    const declarations = direct === undefined
      ? exactCallImplementations?.(call) ?? []
      : [direct];
    for (const declaration of declarations) {
      if (source.navigation.isProjectDeclaration(declaration)) {
        append(mutable, declaration, call);
      }
    }
  }
  return new Map([...mutable].map(([declaration, selected]) => [
    declaration,
    Object.freeze(selected),
  ]));
}

export function indexResultProjectionReads(
  source: TargetSourceProgram,
  program: TargetProgramIndex,
  projections: ExactAggregateProjectionIndex,
  invocationInputs: ExactInvocationInputIndex,
  exactCallImplementations?: (call: Node) => readonly Node[] | undefined,
  transports?: InvocationTransportContract,
): ExactResultProjectionReads {
  const mutable = new Map<Node, Node[]>();
  const invocations = new Map<Node, Node[]>();
  const reads = new Set<Node>();
  const slots = createExactValueSlotFlow(
    source,
    program,
    projections,
    (call) => exactAggregateResultSource(
      source,
      program,
      call,
      exactCallImplementations,
      transports,
    ),
    invocationInputs,
    projections.roots,
  );
  for (const read of program.nodesOfKinds([
    KindElementAccessExpression,
    KindIdentifier,
    KindPropertyAccessExpression,
  ])) {
    const result = slots.resultFor(read);
    if (result?.closed !== true) {
      continue;
    }
    reads.add(read);
    for (const expression of result.expressions) {
      append(mutable, expression, read);
    }
    for (const step of result.steps) {
      append(invocations, step.invocation, read);
    }
  }
  return sealResultProjectionReads(mutable, invocations, reads);
}

export interface ExactResultProjectionReads {
  readonly origins: ReadonlyMap<Node, readonly Node[]>;
  readonly invocations: ReadonlyMap<Node, readonly Node[]>;
  readonly reads: ReadonlySet<Node>;
}

function sealResultProjectionReads(
  origins: ReadonlyMap<Node, readonly Node[]>,
  invocations: ReadonlyMap<Node, readonly Node[]>,
  reads: ReadonlySet<Node>,
): ExactResultProjectionReads {
  const seal = (entries: ReadonlyMap<Node, readonly Node[]>) =>
    new Map([...entries].map(([node, selected]) => [
      node,
      Object.freeze([...selected]),
    ]));
  return Object.freeze({
    origins: seal(origins),
    invocations: seal(invocations),
    reads: Object.freeze(new Set(reads)),
  });
}

function exactAggregateResultSource(
  source: TargetSourceProgram,
  program: TargetProgramIndex,
  call: Node,
  exactCallImplementations: ((call: Node) => readonly Node[] | undefined) |
    undefined,
  transports: InvocationTransportContract | undefined,
): ExactValueSlotCallSource | undefined {
  const semantics = source.semantics.forNode(call);
  const signature = semantics.operations.call(call)?.selectedSignature;
  const contract = signature === undefined
    ? undefined
    : semantics.declarations.signatureDeclaration(signature);
  const transported = transports?.transportFor(call)?.resultOriginExpressions;
  if (transported !== undefined) {
    return Object.freeze({
      resultOwner: call,
      contracts: Object.freeze([]),
      expressions: Object.freeze([...transported]),
    });
  }
  const direct = resolveProjectInvocation(source, call)?.implementation;
  const implementations = direct === undefined
    ? exactCallImplementations?.(call) ?? []
    : [direct];
  if (implementations.length === 0) {
    return undefined;
  }
  const expressions: (Node | undefined)[] = [];
  for (const implementation of implementations) {
    if (
      !source.navigation.isProjectDeclaration(implementation) ||
      !callableDispatchIsClosed(source, program, implementation)
    ) {
      return undefined;
    }
    const returned = exactCallableReturnExpressions(source, implementation);
    if (returned === undefined || returned.length === 0) {
      return undefined;
    }
    expressions.push(...returned);
  }
  return Object.freeze({
    resultOwner: direct ?? call,
    contracts: Object.freeze([
      ...(contract === undefined ? [] : [contract]),
      ...implementations.filter((entry) => entry !== contract),
    ]),
    expressions: Object.freeze(expressions),
  });
}

function storageOwner(
  source: TargetSourceProgram,
  declaration: Node,
): Node | undefined {
  const parent = source.ast.parent(declaration);
  if (parent === undefined) {
    return undefined;
  }
  return source.ast.is.IsClassDeclaration(parent)
    ? parent
    : source.ast.is.IsConstructorDeclaration(parent)
    ? source.ast.parent(parent)
    : undefined;
}

function append(target: Map<Node, Node[]>, key: Node, value: Node): void {
  const selected = target.get(key);
  if (selected === undefined) {
    target.set(key, [value]);
  } else {
    selected.push(value);
  }
}
