import type { Node, Symbol } from "@tsonic/tsts";
import type { TargetSourceProgram } from "@tsonic/target-api";
import {
  KindIdentifier,
  KindVariableDeclaration,
} from "@tsonic/tsts/target-ast";

import type { TargetProgramIndex } from "../program-index.js";

import {
  isFunctionLike,
  transparentExpression,
} from "./syntax.js";

export interface ReturnProjectionFlow {
  isDefinitelyNonThenable(
    expression: Node,
    expressionProof: (expression: Node) => boolean,
  ): boolean;
}

interface AggregateBinding {
  readonly declaration: Node;
  readonly source: Node;
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

export function createReturnProjectionFlow(
  source: TargetSourceProgram,
  program: TargetProgramIndex,
  directCallDeclaration: (call: Node) => Node | undefined,
): ReturnProjectionFlow {
  const bindings = collectAggregateBindings(source, program);
  const symbols = indexBindingSymbols(source, bindings);
  auditAggregateBindings(source, program, bindings, symbols);
  const slotResults = new Map<Node, Map<number, boolean>>();
  const pending = new Map<Node, Set<number>>();

  return Object.freeze({
    isDefinitelyNonThenable(
      expression: Node,
      expressionProof: (expression: Node) => boolean,
    ): boolean {
      const projection = exactAggregateProjection(
        source,
        expression,
        bindings,
        symbols,
      );
      if (projection === undefined || !projection.binding.closed) {
        return false;
      }
      const callSlotIsNonThenable = (
        call: Node,
        index: number,
      ): boolean => proveCallSlot(
        source,
        call,
        index,
        bindings,
        symbols,
        directCallDeclaration,
        expressionProof,
        slotResults,
        pending,
        callSlotIsNonThenable,
      );
      return sourceSlotIsNonThenable(
        source,
        projection.binding.source,
        projection.index,
        bindings,
        symbols,
        directCallDeclaration,
        callSlotIsNonThenable,
        expressionProof,
      );
    },
  });
}

function proveCallSlot(
  source: TargetSourceProgram,
  call: Node,
  index: number,
  bindings: ReadonlyMap<Node, AggregateBinding>,
  symbols: ReadonlyMap<Symbol, AggregateBinding>,
  directCallDeclaration: (call: Node) => Node | undefined,
  expressionProof: (expression: Node) => boolean,
  slotResults: Map<Node, Map<number, boolean>>,
  pending: Map<Node, Set<number>>,
  callSlotIsNonThenable: (call: Node, index: number) => boolean,
): boolean {
  const declaration = directCallDeclaration(call);
  if (declaration === undefined) {
    return false;
  }
  const cached = slotResults.get(declaration)?.get(index);
  if (cached !== undefined) {
    return cached;
  }
  const declarationPending = pending.get(declaration);
  if (declarationPending?.has(index) === true) {
    return false;
  }
  if (declarationPending === undefined) {
    pending.set(declaration, new Set([index]));
  } else {
    declarationPending.add(index);
  }
  const returned = directReturnExpressions(source, declaration);
  const result = returned !== undefined &&
    returned.length !== 0 &&
    returned.every((expression) =>
      slotValueIsDefinitelyNonThenable(
        source,
        expression,
        index,
        bindings,
        symbols,
        directCallDeclaration,
        callSlotIsNonThenable,
        expressionProof,
      )
    );
  pending.get(declaration)?.delete(index);
  const results = slotResults.get(declaration);
  if (results === undefined) {
    slotResults.set(declaration, new Map([[index, result]]));
  } else {
    results.set(index, result);
  }
  return result;
}

function collectAggregateBindings(
  source: TargetSourceProgram,
  program: TargetProgramIndex,
): ReadonlyMap<Node, AggregateBinding> {
  const bindings = new Map<Node, AggregateBinding>();
  for (const node of program.nodesOfKind(KindVariableDeclaration)) {
    if (
      source.ast.variableDeclarationKind(node) !== "const" ||
      !source.ast.is.IsIdentifier(source.ast.name(node))
    ) {
      continue;
    }
    const initializer = source.ast.as.AsVariableDeclaration(node)?.Initializer;
    const value = unwrapAwait(source, initializer);
    if (
      value !== undefined &&
      (source.ast.is.IsCallExpression(value) ||
        source.ast.is.IsArrayLiteralExpression(value))
    ) {
      bindings.set(node, { declaration: node, source: value, closed: true });
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
  for (const node of program.nodesOfKind(KindIdentifier)) {
    const binding = bindingForReference(source, symbols, node);
    if (
      binding === undefined ||
      node === source.ast.name(binding.declaration)
    ) {
      continue;
    }
    if (exactProjectionAtReference(source, node) === undefined) {
      binding.closed = false;
    }
  }
}

function directReturnExpressions(
  source: TargetSourceProgram,
  declaration: Node,
): readonly Node[] | undefined {
  const body = source.ast.body(declaration);
  if (body === undefined) {
    return undefined;
  }
  if (
    source.ast.is.IsArrowFunction(declaration) &&
    !source.ast.is.IsBlock(body)
  ) {
    return [body];
  }
  const returns: Node[] = [];
  const work = [body];
  while (work.length !== 0) {
    const node = work.pop();
    if (node === undefined) {
      continue;
    }
    if (node !== body && isFunctionLike(source, node)) {
      continue;
    }
    if (source.ast.is.IsReturnStatement(node)) {
      const expression = source.ast.as.AsReturnStatement(node)?.Expression;
      if (expression === undefined) {
        return undefined;
      }
      returns.push(expression);
      continue;
    }
    for (const child of source.ast.children(node)) {
      if (child !== undefined) {
        work.push(child);
      }
    }
  }
  if (returns.length === 0) {
    return undefined;
  }
  return returns;
}

function slotValueIsDefinitelyNonThenable(
  source: TargetSourceProgram,
  expression: Node,
  index: number,
  bindings: ReadonlyMap<Node, AggregateBinding>,
  symbols: ReadonlyMap<Symbol, AggregateBinding>,
  directCallDeclaration: (call: Node) => Node | undefined,
  callSlotIsNonThenable: (call: Node, index: number) => boolean,
  expressionIsDefinitelyNonThenable: (expression: Node) => boolean,
): boolean {
  const value = unwrapAwait(source, expression);
  if (value === undefined) {
    return false;
  }
  if (source.ast.is.IsConditionalExpression(value)) {
    const conditional = source.ast.as.AsConditionalExpression(value);
    return conditional?.WhenTrue !== undefined &&
      conditional.WhenFalse !== undefined &&
      slotValueIsDefinitelyNonThenable(
          source,
          conditional.WhenTrue,
          index,
          bindings,
          symbols,
          directCallDeclaration,
          callSlotIsNonThenable,
          expressionIsDefinitelyNonThenable,
        ) &&
      slotValueIsDefinitelyNonThenable(
          source,
          conditional.WhenFalse,
          index,
          bindings,
          symbols,
          directCallDeclaration,
          callSlotIsNonThenable,
          expressionIsDefinitelyNonThenable,
        );
  }
  if (source.ast.is.IsArrayLiteralExpression(value)) {
    const selected = source.ast.elements(value)[index];
    return selected !== undefined &&
      !source.ast.is.IsSpreadElement(selected) &&
      expressionIsDefinitelyNonThenable(selected);
  }
  if (source.ast.is.IsCallExpression(value)) {
    return directCallDeclaration(value) !== undefined &&
      callSlotIsNonThenable(value, index);
  }
  if (source.ast.is.IsIdentifier(value)) {
    const binding = bindingForReference(source, symbols, value);
    return binding !== undefined &&
      binding.closed &&
      slotValueIsDefinitelyNonThenable(
          source,
          binding.source,
          index,
          bindings,
          symbols,
          directCallDeclaration,
          callSlotIsNonThenable,
          expressionIsDefinitelyNonThenable,
        );
  }
  return false;
}

function sourceSlotIsNonThenable(
  source: TargetSourceProgram,
  aggregateSource: Node,
  index: number,
  bindings: ReadonlyMap<Node, AggregateBinding>,
  symbols: ReadonlyMap<Symbol, AggregateBinding>,
  directCallDeclaration: (call: Node) => Node | undefined,
  callSlotIsNonThenable: (call: Node, index: number) => boolean,
  expressionIsDefinitelyNonThenable: (expression: Node) => boolean,
): boolean {
  return slotValueIsDefinitelyNonThenable(
    source,
    aggregateSource,
    index,
    bindings,
    symbols,
    directCallDeclaration,
    callSlotIsNonThenable,
    expressionIsDefinitelyNonThenable,
  );
}

function exactAggregateProjection(
  source: TargetSourceProgram,
  expression: Node,
  bindings: ReadonlyMap<Node, AggregateBinding>,
  symbols: ReadonlyMap<Symbol, AggregateBinding>,
): { readonly binding: AggregateBinding; readonly index: number } | undefined {
  const root = transparentExpression(source, expression);
  if (root === undefined || !source.ast.is.IsElementAccessExpression(root)) {
    return undefined;
  }
  const element = source.ast.as.AsElementAccessExpression(root);
  const receiver = transparentExpression(source, element?.Expression);
  const binding = receiver === undefined || !source.ast.is.IsIdentifier(receiver)
    ? undefined
    : bindingForReference(source, symbols, receiver);
  const index = exactElementIndex(source, element?.ArgumentExpression);
  return binding === undefined || !bindings.has(binding.declaration) || index === undefined
    ? undefined
    : { binding, index };
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
      const selected = source.semantics.forNode(parent)
        .getResolvedElementAccessInfo(parent);
      return element?.Expression === current &&
          selected?.accessMode === "read" &&
          !selected.optionalChain &&
          !isWrittenExpression(source, parent)
        ? exactElementIndex(source, element.ArgumentExpression)
        : undefined;
    }
    if (transparentExpression(source, parent) !== current) {
      return undefined;
    }
    current = parent;
  }
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

function unwrapAwait(
  source: TargetSourceProgram,
  expression: Node | undefined,
): Node | undefined {
  const root = transparentExpression(source, expression);
  return root !== undefined && source.ast.is.IsAwaitExpression(root)
    ? transparentExpression(
        source,
        source.ast.as.AsAwaitExpression(root)?.Expression,
      )
    : root;
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
    const indexed = symbols.get(symbol);
    if (indexed !== undefined) {
      return indexed;
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
