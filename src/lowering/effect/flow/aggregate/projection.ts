import type { Node, Symbol } from "@tsonic/tsts";
import type { TargetSourceProgram } from "@tsonic/target-api";
import {
  KindIdentifier,
  KindVariableDeclaration,
} from "@tsonic/tsts/target-ast";

import type { TargetProgramIndex } from "../../../program-index.js";
import { transparentExpression } from "../../model/syntax.js";

export interface ExactAggregateSource {
  readonly declaration: Node | undefined;
  readonly initializer: Node;
  readonly aggregate: Node;
}

export interface ExactAggregateProjection {
  readonly source: ExactAggregateSource;
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
  return Object.freeze({
    projectionFor(expression: Node): ExactAggregateProjection | undefined {
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
      if (receiver === undefined || index === undefined) {
        return undefined;
      }
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

function collectAggregateBindings(
  source: TargetSourceProgram,
  program: TargetProgramIndex,
): ReadonlyMap<Node, AggregateBinding> {
  const bindings = new Map<Node, AggregateBinding>();
  for (const declaration of program.nodesOfKind(KindVariableDeclaration)) {
    if (
      source.ast.variableDeclarationKind(declaration) !== "const" ||
      !source.ast.is.IsIdentifier(source.ast.name(declaration))
    ) {
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
    if (exactProjectionAtReference(source, reference) === undefined) {
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
  return aggregate !== undefined &&
      (source.ast.is.IsCallExpression(aggregate) ||
        source.ast.is.IsArrayLiteralExpression(aggregate))
    ? Object.freeze({ declaration, initializer, aggregate })
    : undefined;
}

function exactProjectionAtReference(
  source: TargetSourceProgram,
  reference: Node,
): number | undefined {
  let current = reference;
  for (;;) {
    const parent = source.ast.parent(current);
    if (parent === undefined) {
      return undefined;
    }
    if (source.ast.is.IsElementAccessExpression(parent)) {
      const element = source.ast.as.AsElementAccessExpression(parent);
      return element?.Expression === current && elementAccessIsExactRead(
          source,
          parent,
        )
        ? exactElementIndex(source, element.ArgumentExpression)
        : undefined;
    }
    if (transparentExpression(source, parent) !== current) {
      return undefined;
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
