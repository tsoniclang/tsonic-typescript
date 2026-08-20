import type { Node, Symbol } from "@tsonic/tsts";
import type { TargetSourceProgram } from "@tsonic/target-api";
import {
  KindBindingElement,
  KindIdentifier,
  KindVariableDeclaration,
} from "@tsonic/tsts/target-ast";

import type { TargetProgramIndex } from "../../../program-index.js";
import { transparentExpression } from "../../model/syntax.js";
import { sameValueAlternatives } from "../value/alternatives.js";

export interface ExactAggregateSource {
  readonly declaration: Node | undefined;
  readonly initializer: Node;
  readonly aggregate: Node;
}

export interface ExactAggregateProjection {
  readonly source: ExactAggregateSource;
  readonly index: number;
}

export interface ExactAggregateRead {
  readonly receiver: Node;
  readonly index: number;
}

export interface ExactAggregateProjectionIndex {
  projectionFor(expression: Node): ExactAggregateProjection | undefined;
  sourceForReference(expression: Node): ExactAggregateSource | undefined;
}

interface AggregateBinding {
  readonly source: ExactAggregateSource;
  closed: boolean;
}

const assignmentOperators = new Set([
  "KindEqualsToken",
  "KindPlusEqualsToken",
  "KindMinusEqualsToken",
  "KindAsteriskEqualsToken",
  "KindAsteriskAsteriskEqualsToken",
  "KindSlashEqualsToken",
  "KindPercentEqualsToken",
  "KindLessThanLessThanEqualsToken",
  "KindGreaterThanGreaterThanEqualsToken",
  "KindGreaterThanGreaterThanGreaterThanEqualsToken",
  "KindAmpersandEqualsToken",
  "KindBarEqualsToken",
  "KindCaretEqualsToken",
  "KindBarBarEqualsToken",
  "KindAmpersandAmpersandEqualsToken",
  "KindQuestionQuestionEqualsToken",
]);

const updateOperators = new Set([
  "KindPlusPlusToken",
  "KindMinusMinusToken",
]);

export function createExactAggregateProjectionIndex(
  source: TargetSourceProgram,
  program: TargetProgramIndex,
): ExactAggregateProjectionIndex {
  const bindings = collectAggregateBindings(source, program);
  const symbols = indexBindingSymbols(source, bindings);
  auditAggregateBindings(source, program, bindings, symbols);
  const destructured = collectDestructuredProjections(source, program);
  return Object.freeze({
    projectionFor(expression: Node): ExactAggregateProjection | undefined {
      const root = transparentExpression(source, expression);
      if (root === undefined) {
        return undefined;
      }
      if (source.ast.is.IsIdentifier(root)) {
        const reference = program.declarationReferenceFor(root);
        const projection = reference?.project === true
          ? destructured.get(reference.declaration)
          : undefined;
        return projection !== undefined &&
            root !== source.ast.name(reference?.declaration)
          ? projection
          : undefined;
      }
      const read = exactAggregateRead(source, root);
      if (read === undefined) {
        return undefined;
      }
      const { receiver, index } = read;
      const binding = source.ast.is.IsIdentifier(receiver)
        ? bindingForReference(source, symbols, receiver)
        : undefined;
      const aggregate = binding?.closed === true
        ? binding.source
        : exactAggregateSource(source, undefined, receiver);
      return aggregate === undefined
        ? undefined
        : Object.freeze({ source: aggregate, index });
    },
    sourceForReference(expression: Node): ExactAggregateSource | undefined {
      const root = transparentExpression(source, expression);
      if (root === undefined || !source.ast.is.IsIdentifier(root)) {
        return undefined;
      }
      const binding = bindingForReference(source, symbols, root);
      return binding?.closed === true ? binding.source : undefined;
    },
  });
}

export function exactAggregateRead(
  source: TargetSourceProgram,
  expression: Node,
): ExactAggregateRead | undefined {
  const root = transparentExpression(source, expression);
  if (
    root === undefined ||
    !source.ast.is.IsElementAccessExpression(root) ||
    !elementAccessIsExactRead(source, root)
  ) {
    return undefined;
  }
  const element = source.ast.as.AsElementAccessExpression(root);
  const receiver = transparentExpression(source, element?.Expression);
  const index = exactElementIndex(source, element?.ArgumentExpression);
  const receiverType = receiver === undefined
    ? undefined
    : source.semantics.forNode(receiver).getTypeAtLocation(receiver);
  return receiver === undefined ||
      index === undefined ||
      receiverType === undefined ||
      !source.semantics.forNode(receiver).isArrayLike(receiverType)
    ? undefined
    : Object.freeze({ receiver, index });
}

function collectDestructuredProjections(
  source: TargetSourceProgram,
  program: TargetProgramIndex,
): ReadonlyMap<Node, ExactAggregateProjection> {
  const result = new Map<Node, ExactAggregateProjection>();
  for (const declaration of program.nodesOfKind(KindBindingElement)) {
    const binding = source.ast.as.AsBindingElement(declaration);
    const pattern = source.ast.parent(declaration);
    const owner = source.ast.parent(pattern);
    if (
      binding?.DotDotDotToken !== undefined ||
      binding?.Initializer !== undefined ||
      pattern === undefined ||
      !source.ast.is.IsArrayBindingPattern(pattern) ||
      owner === undefined ||
      !source.ast.is.IsVariableDeclaration(owner) ||
      program.hasBindingWrite(declaration)
    ) {
      continue;
    }
    const index = source.ast.elements(pattern).indexOf(declaration);
    const initializer = source.ast.as.AsVariableDeclaration(owner)?.Initializer;
    const aggregate = exactAggregateSource(source, owner, initializer);
    if (index >= 0 && aggregate !== undefined) {
      result.set(declaration, Object.freeze({ source: aggregate, index }));
    }
  }
  return result;
}

function collectAggregateBindings(
  source: TargetSourceProgram,
  program: TargetProgramIndex,
): ReadonlyMap<Node, AggregateBinding> {
  const bindings = new Map<Node, AggregateBinding>();
  for (const declaration of program.nodesOfKind(KindVariableDeclaration)) {
    if (!source.ast.is.IsIdentifier(source.ast.name(declaration))) {
      continue;
    }
    const initializer = source.ast.as.AsVariableDeclaration(declaration)
      ?.Initializer;
    const aggregate = exactAggregateSource(source, declaration, initializer);
    if (aggregate !== undefined) {
      bindings.set(declaration, { source: aggregate, closed: true });
    }
  }
  return bindings;
}

function auditAggregateBindings(
  source: TargetSourceProgram,
  program: TargetProgramIndex,
  bindings: ReadonlyMap<Node, AggregateBinding>,
  symbols: ReadonlyMap<Symbol, AggregateBinding>,
): void {
  if (bindings.size === 0) {
    return;
  }
  for (const reference of program.nodesOfKind(KindIdentifier)) {
    const binding = bindingForReference(source, symbols, reference);
    if (
      binding === undefined ||
      reference === source.ast.name(binding.source.declaration)
    ) {
      continue;
    }
    if (!exactAggregateUseAtReference(source, reference)) {
      binding.closed = false;
    }
  }
}

function exactAggregateSource(
  source: TargetSourceProgram,
  declaration: Node | undefined,
  expression: Node | undefined,
): ExactAggregateSource | undefined {
  const initializer = transparentExpression(source, expression);
  if (initializer === undefined) {
    return undefined;
  }
  const aggregate = source.ast.is.IsAwaitExpression(initializer)
    ? transparentExpression(
        source,
        source.ast.as.AsAwaitExpression(initializer)?.Expression,
      )
    : initializer;
  return aggregate !== undefined && exactAggregateExpression(source, aggregate)
    ? Object.freeze({ declaration, initializer, aggregate })
    : undefined;
}

function exactAggregateExpression(
  source: TargetSourceProgram,
  expression: Node,
  pending: ReadonlySet<Node> = new Set(),
): boolean {
  const root = transparentExpression(source, expression);
  if (root === undefined || pending.has(root)) {
    return false;
  }
  if (
    source.ast.is.IsCallExpression(root) ||
    source.ast.is.IsArrayLiteralExpression(root)
  ) {
    return true;
  }
  if (source.ast.is.IsAwaitExpression(root)) {
    const awaited = source.ast.as.AsAwaitExpression(root)?.Expression;
    return awaited !== undefined && exactAggregateExpression(
      source,
      awaited,
      new Set([...pending, root]),
    );
  }
  const alternatives = sameValueAlternatives(source, root);
  return alternatives !== undefined && alternatives !== null &&
    alternatives.length !== 0 && alternatives.every((alternative) =>
      exactAggregateExpression(
        source,
        alternative,
        new Set([...pending, root]),
      )
    );
}

function exactAggregateUseAtReference(
  source: TargetSourceProgram,
  reference: Node,
): boolean {
  let current = reference;
  for (;;) {
    const parent = source.ast.parent(current);
    if (parent === undefined) {
      return false;
    }
    if (source.ast.is.IsElementAccessExpression(parent)) {
      const element = source.ast.as.AsElementAccessExpression(parent);
      return element?.Expression === current && elementAccessIsExactRead(
          source,
          parent,
        )
        ? exactElementIndex(source, element.ArgumentExpression) !== undefined
        : false;
    }
    if (source.ast.is.IsSpreadElement(parent)) {
      const invocation = source.ast.parent(parent);
      return source.ast.as.AsSpreadElement(parent)?.Expression === current &&
        invocation !== undefined &&
        (
          source.ast.is.IsCallExpression(invocation) ||
          source.ast.is.IsNewExpression(invocation)
        ) && source.ast.arguments(invocation).includes(parent);
    }
    if (transparentExpression(source, parent) !== current) {
      return false;
    }
    current = parent;
  }
}

function elementAccessIsExactRead(
  source: TargetSourceProgram,
  expression: Node,
): boolean {
  const selected = source.semantics.forNode(expression)
    .getResolvedElementAccessInfo(expression);
  return selected?.accessMode === "read" &&
    !selected.optionalChain &&
    !isWrittenExpression(source, expression);
}

function isWrittenExpression(
  source: TargetSourceProgram,
  expression: Node,
): boolean {
  const parent = source.ast.parent(expression);
  if (parent === undefined) {
    return false;
  }
  if (source.ast.is.IsBinaryExpression(parent)) {
    const binary = source.ast.as.AsBinaryExpression(parent);
    return binary?.Left === expression &&
      assignmentOperators.has(source.ast.operatorKindName(parent) ?? "");
  }
  return (
    source.ast.is.IsPrefixUnaryExpression(parent) ||
    source.ast.is.IsPostfixUnaryExpression(parent)
  ) && updateOperators.has(source.ast.operatorKindName(parent) ?? "");
}

function exactElementIndex(
  source: TargetSourceProgram,
  expression: Node | undefined,
): number | undefined {
  const root = transparentExpression(source, expression);
  if (root === undefined || !source.ast.is.IsNumericLiteral(root)) {
    return undefined;
  }
  const value = Number(source.ast.text(root));
  return Number.isSafeInteger(value) && value >= 0 ? value : undefined;
}

function indexBindingSymbols(
  source: TargetSourceProgram,
  bindings: ReadonlyMap<Node, AggregateBinding>,
): ReadonlyMap<Symbol, AggregateBinding> {
  const result = new Map<Symbol, AggregateBinding>();
  for (const [declaration, binding] of bindings) {
    for (const symbol of exactSymbolsAt(source, source.ast.name(declaration))) {
      result.set(symbol, binding);
    }
  }
  return result;
}

function bindingForReference(
  source: TargetSourceProgram,
  symbols: ReadonlyMap<Symbol, AggregateBinding>,
  node: Node,
): AggregateBinding | undefined {
  for (const symbol of exactSymbolsAt(source, node)) {
    const binding = symbols.get(symbol);
    if (binding !== undefined) {
      return binding;
    }
  }
  return undefined;
}

function exactSymbolsAt(
  source: TargetSourceProgram,
  node: Node | undefined,
): readonly Symbol[] {
  if (node === undefined) {
    return [];
  }
  const semantics = source.semantics.forNode(node);
  return [...new Set([
    semantics.getSymbolAtLocation(node),
    semantics.getResolvedSymbol(node),
  ].filter((symbol): symbol is Symbol => symbol !== undefined))];
}
