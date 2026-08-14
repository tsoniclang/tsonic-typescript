import type { Node } from "@tsonic/tsts";
import type { TargetSourceProgram } from "@tsonic/target-api";
import type { TargetProgramIndex } from "../program-index.js";

import {
  callableDispatchIsClosed,
  isFunctionLike,
} from "./syntax.js";
import {
  callableContractResultIsDefinitelyNonThenable,
  resolvedCallResultIsDefinitelyNonThenable,
} from "./synchronous.js";

export interface ReturnProofScope {
  readonly inputs: ReadonlyMap<Node, ReturnProofValue>;
  readonly root: boolean;
}

export interface ReturnProofValue {
  readonly expression: Node;
  readonly scope: ReturnProofScope;
}

export type ReturnExpressionProof = (
  value: ReturnProofValue,
  pendingDeclarations: Set<Node>,
  settledDeclarations: ReadonlySet<Node> | undefined,
) => boolean;

export interface ReturnCallFlow {
  directDeclaration(call: Node): Node | undefined;
  isDefinitelyNonThenable(
    value: ReturnProofValue,
    declarations: readonly Node[],
    expressionProof: ReturnExpressionProof,
    pendingDeclarations: Set<Node>,
    settledDeclarations?: ReadonlySet<Node>,
  ): boolean;
}

export function createReturnCallFlow(
  source: TargetSourceProgram,
  program: TargetProgramIndex,
  settledCallDeclarations: (call: Node) => readonly Node[],
): ReturnCallFlow {
  const directDeclarations = new Map<Node, Node | null>();
  const returns = new Map<Node, readonly (Node | undefined)[]>();
  const parameterlessResults = new Map<
    ReadonlySet<Node> | undefined,
    Map<Node, boolean>
  >();
  return Object.freeze({
    directDeclaration(call: Node): Node | undefined {
      const existing = directDeclarations.get(call);
      if (existing !== undefined) {
        return existing ?? undefined;
      }
      const declaration = directProjectCallDeclaration(source, program, call);
      directDeclarations.set(call, declaration ?? null);
      return declaration;
    },
    isDefinitelyNonThenable(
      value: ReturnProofValue,
      declarations: readonly Node[],
      expressionProof: ReturnExpressionProof,
      pendingDeclarations: Set<Node>,
      settledDeclarations?: ReadonlySet<Node>,
    ): boolean {
      if (
        !source.ast.is.IsCallExpression(value.expression) ||
        source.ast.arguments(value.expression).some((argument) =>
          source.ast.is.IsSpreadElement(argument)
        )
      ) {
        return false;
      }
      if (resolvedCallResultIsDefinitelyNonThenable(
        source,
        value.expression,
      )) {
        return true;
      }
      const selectedDeclarations = exactCallDeclarations(
        source,
        value,
        declarations,
        settledDeclarations,
        settledCallDeclarations,
      );
      if (selectedDeclarations.length === 0) {
        return false;
      }
      if (selectedDeclarations.every((declaration) =>
        callableContractResultIsDefinitelyNonThenable(
          source,
          declaration,
        )
      )) {
        return true;
      }
      return selectedDeclarations.every((declaration) =>
        declarationResultIsDefinitelyNonThenable(
          source,
          program,
          value,
          declaration,
          expressionProof,
          pendingDeclarations,
          returns,
          parameterlessResults,
          settledDeclarations,
        )
      );
    },
  });
}

function declarationResultIsDefinitelyNonThenable(
  source: TargetSourceProgram,
  program: TargetProgramIndex,
  callValue: ReturnProofValue,
  declaration: Node,
  expressionProof: ReturnExpressionProof,
  pendingDeclarations: Set<Node>,
  returnCache: Map<Node, readonly (Node | undefined)[]>,
  parameterlessResults: Map<
    ReadonlySet<Node> | undefined,
    Map<Node, boolean>
  >,
  settledDeclarations: ReadonlySet<Node> | undefined,
): boolean {
  if (
    !source.navigation.isProjectDeclaration(declaration) ||
    !callableDeclarationIsInspectable(
      source,
      program,
      declaration,
      settledDeclarations,
    ) ||
    pendingDeclarations.has(declaration)
  ) {
    return false;
  }
  const parameters = source.ast.parameters(declaration);
  const cacheable = parameters.length === 0 &&
    !source.ast.is.IsMethodDeclaration(declaration) &&
    containingFunction(source, declaration) === undefined;
  const resultCache = cacheForSettlement(
    parameterlessResults,
    settledDeclarations,
  );
  const cached = cacheable
    ? resultCache.get(declaration)
    : undefined;
  if (cached !== undefined) {
    return cached;
  }
  const scope = callScope(source, callValue, declaration);
  if (scope === undefined) {
    return false;
  }
  let returns = returnCache.get(declaration);
  if (returns === undefined) {
    returns = directReturnExpressions(source, declaration);
    if (returns !== undefined) {
      returnCache.set(declaration, returns);
    }
  }
  if (returns === undefined) {
    return false;
  }
  if (returns.length === 0) {
    if (cacheable) {
      resultCache.set(declaration, true);
    }
    return true;
  }
  pendingDeclarations.add(declaration);
  const result = returns.every((expression) =>
    expression === undefined || expressionProof(
      { expression, scope },
      pendingDeclarations,
      settledDeclarations,
    )
  );
  pendingDeclarations.delete(declaration);
  if (cacheable) {
    resultCache.set(declaration, result);
  }
  return result;
}

function cacheForSettlement(
  caches: Map<
    ReadonlySet<Node> | undefined,
    Map<Node, boolean>
  >,
  settledDeclarations: ReadonlySet<Node> | undefined,
): Map<Node, boolean> {
  const existing = caches.get(settledDeclarations);
  if (existing !== undefined) {
    return existing;
  }
  const created = new Map<Node, boolean>();
  caches.set(settledDeclarations, created);
  return created;
}

function callableDeclarationIsInspectable(
  source: TargetSourceProgram,
  program: TargetProgramIndex,
  declaration: Node,
  settledDeclarations?: ReadonlySet<Node>,
): boolean {
  if (
    source.ast.body(declaration) === undefined ||
    (source.ast.hasModifierKind(declaration, "async") &&
      settledDeclarations?.has(declaration) !== true) ||
    !callableDispatchIsClosed(source, program, declaration)
  ) {
    return false;
  }
  return source.ast.is.IsFunctionDeclaration(declaration) ||
      source.ast.is.IsFunctionExpression(declaration) ||
      source.ast.is.IsArrowFunction(declaration) ||
      source.ast.is.IsMethodDeclaration(declaration)
    ? !callableIsGenerator(source, declaration)
    : false;
}

function exactCallDeclarations(
  source: TargetSourceProgram,
  value: ReturnProofValue,
  declarations: readonly Node[],
  settledDeclarations: ReadonlySet<Node> | undefined,
  settledCallDeclarations: (call: Node) => readonly Node[],
): readonly Node[] {
  const selected = new Set(declarations);
  const semantics = source.semantics.forNode(value.expression);
  const direct = semantics.getSignatureDeclaration(
    semantics.getResolvedSignature(value.expression),
  );
  if (direct !== undefined && settledDeclarations?.has(direct) === true) {
    selected.add(direct);
  }
  const conditional = settledCallDeclarations(value.expression);
  if (conditional.some((declaration) =>
    settledDeclarations?.has(declaration) !== true
  )) {
    return [];
  }
  for (const declaration of conditional) {
    selected.add(declaration);
  }
  return [...selected];
}

function callableIsGenerator(
  source: TargetSourceProgram,
  declaration: Node,
): boolean {
  if (source.ast.is.IsFunctionDeclaration(declaration)) {
    return source.ast.as.AsFunctionDeclaration(declaration)?.AsteriskToken !==
      undefined;
  }
  if (source.ast.is.IsFunctionExpression(declaration)) {
    return source.ast.as.AsFunctionExpression(declaration)?.AsteriskToken !==
      undefined;
  }
  if (source.ast.is.IsMethodDeclaration(declaration)) {
    return source.ast.as.AsMethodDeclaration(declaration)?.AsteriskToken !==
      undefined;
  }
  return false;
}

function callScope(
  source: TargetSourceProgram,
  callValue: ReturnProofValue,
  declaration: Node,
): ReturnProofScope | undefined {
  const parameters = source.ast.parameters(declaration);
  const arguments_ = source.ast.arguments(callValue.expression);
  if (
    parameters.some((parameter) =>
      source.ast.as.AsParameterDeclaration(parameter)?.DotDotDotToken !== undefined
    ) ||
    parameters.length > arguments_.length
  ) {
    return undefined;
  }
  const inputs = new Map<Node, ReturnProofValue>();
  for (let index = 0; index < parameters.length; index += 1) {
    const parameter = parameters[index];
    const argument = arguments_[index];
    if (parameter === undefined || argument === undefined) {
      return undefined;
    }
    inputs.set(parameter, {
      expression: argument,
      scope: callValue.scope,
    });
  }
  return Object.freeze({ inputs, root: false });
}

function directReturnExpressions(
  source: TargetSourceProgram,
  declaration: Node,
): readonly (Node | undefined)[] | undefined {
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
  const returns: (Node | undefined)[] = [];
  const pending = [body];
  while (pending.length !== 0) {
    const node = pending.pop();
    if (node === undefined) {
      continue;
    }
    if (node !== body && isFunctionLike(source, node)) {
      continue;
    }
    if (source.ast.is.IsReturnStatement(node)) {
      returns.push(source.ast.as.AsReturnStatement(node)?.Expression);
      continue;
    }
    for (const child of source.ast.children(node)) {
      if (child !== undefined) {
        pending.push(child);
      }
    }
  }
  return returns;
}

function directProjectCallDeclaration(
  source: TargetSourceProgram,
  program: TargetProgramIndex,
  call: Node,
): Node | undefined {
  if (!source.ast.is.IsCallExpression(call)) {
    return undefined;
  }
  const semantics = source.semantics.forNode(call);
  const declaration = semantics.getSignatureDeclaration(
    semantics.getResolvedSignature(call),
  );
  return declaration !== undefined &&
      source.navigation.isProjectDeclaration(declaration) &&
      callableDeclarationIsInspectable(source, program, declaration)
    ? declaration
    : undefined;
}

function containingFunction(
  source: TargetSourceProgram,
  declaration: Node,
): Node | undefined {
  let current = source.ast.parent(declaration);
  while (current !== undefined) {
    if (isFunctionLike(source, current)) {
      return current;
    }
    current = source.ast.parent(current);
  }
  return undefined;
}
