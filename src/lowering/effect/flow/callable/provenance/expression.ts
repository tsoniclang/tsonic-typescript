import type { Node } from "@tsonic/tsts";

import {
  exactCallableTarget,
  isFunctionLike,
  transparentExpression,
} from "../../../model/syntax.js";
import {
  callableUsesSynchronousTransport,
  resolvedCallUsesSynchronousTransport,
} from "../../../model/synchronous.js";
import {
  referenceHasExactSemantics,
  resolveProjectInvocation,
} from "../../../model/project-invocation.js";
import { sameValueAlternatives } from "../../value/alternatives.js";
import { invocationTransportResultOrigins } from "../invocation-transport.js";
import { declarationForSymbols } from "../input-reference.js";
import type {
  CallableContext,
  CallableState,
} from "../provenance-flow.js";
import {
  boundary,
  candidateOrigin,
  dependency,
  emptyOrigin,
  newState,
  synchronousOrigin,
} from "./state.js";

export function callableExpressionState(
  expression: Node,
  context: CallableContext,
): CallableState {
  const root = transparentExpression(context.source, expression);
  const selected = root ?? expression;
  let state = context.expressions.get(selected);
  if (state === undefined) {
    state = newState("expression", selected, context);
    context.expressions.set(selected, state);
  }
  if (state.expanded) {
    return state;
  }
  state.expanded = true;
  if (root === undefined) {
    boundary(state, "unresolved-expression", expression, context);
    return state;
  }
  expandExpression(state, root, context);
  return state;
}

export function callableDeclarationState(
  declaration: Node,
  context: CallableContext,
): CallableState {
  let state = context.declarations.get(declaration);
  if (state === undefined) {
    state = newState(
      isFunctionLike(context.source, declaration) ? "callable" : "binding",
      declaration,
      context,
    );
    context.declarations.set(declaration, state);
  }
  if (state.expanded) {
    return state;
  }
  state.expanded = true;
  if (
    isFunctionLike(context.source, declaration) &&
    context.program.hasBindingWrite(declaration)
  ) {
    boundary(state, "open-binding", declaration, context);
    return state;
  }
  if (context.candidates.has(declaration)) {
    candidateOrigin(state, declaration, context);
    return state;
  }
  if (callableUsesSynchronousTransport(context.source, declaration)) {
    synchronousOrigin(state, declaration, context);
    return state;
  }
  const values = context.inputs.valuesFor(declaration);
  if (values === undefined || !context.inputs.isClosed(declaration)) {
    boundary(state, "open-binding", declaration, context);
    return state;
  }
  if (values.length === 0) {
    emptyOrigin(state, declaration, context);
  }
  for (const value of values) {
    dependency(
      state,
      callableExpressionState(value, context),
      "assignment",
      declaration,
      context,
    );
  }
  return state;
}

function expandExpression(
  state: CallableState,
  root: Node,
  context: CallableContext,
): void {
  const { source } = context;
  const alternatives = sameValueAlternatives(source, root);
  if (alternatives === null) {
    boundary(state, "unresolved-expression", root, context);
    return;
  }
  if (alternatives !== undefined) {
    for (const branch of alternatives) {
      dependency(
        state,
        callableExpressionState(branch, context),
        "conditional",
        root,
        context,
      );
    }
    return;
  }
  const semantics = source.semantics.forNode(root);
  const type = semantics.types.expressionType(root);
  if (
    source.ast.is.IsVoidExpression(root) ||
    (type !== undefined && semantics.types.isNullish(type))
  ) {
    emptyOrigin(state, root, context);
    return;
  }
  if (
    source.ast.is.IsArrowFunction(root) ||
    source.ast.is.IsFunctionExpression(root)
  ) {
    context.callableReferences.set(root, state);
    selectCallableOrigin(state, root, root, context);
    return;
  }
  if (source.ast.is.IsCallExpression(root)) {
    const transported = invocationTransportResultOrigins(root, context.transports);
    if (transported !== undefined) {
      if (transported.length === 0) {
        emptyOrigin(state, root, context);
      }
      for (const origin of transported) {
        dependency(
          state,
          callableExpressionState(origin, context),
          "provider-transport",
          root,
          context,
        );
      }
      return;
    }
  }
  const objectProperty = context.objectProjections?.projectionFor(root);
  if (objectProperty !== undefined) {
    for (const initializer of objectProperty.initializers) {
      dependency(
        state,
        callableExpressionState(initializer, context),
        "field",
        root,
        context,
      );
    }
    return;
  }
  const returned = context.results.resultFor(root);
  if (returned !== undefined) {
    if (
      returned.projectionConsumers !== undefined &&
      !context.inputs.projectionConsumersAreClosed(returned.projectionConsumers)
    ) {
      boundary(state, "open-projection", root, context);
      return;
    }
    for (const returnedExpression of returned.expressions) {
      if (returnedExpression === undefined) {
        emptyOrigin(state, root, context);
      } else {
        dependency(
          state,
          callableExpressionState(returnedExpression, context),
          "return",
          root,
          context,
        );
      }
    }
    context.returnedContracts.set(root, {
      returnTypes: returned.returnTypes,
      state,
    });
    return;
  }
  const slot = context.slots.resultFor(root);
  if (slot?.closed === true) {
    if (slot.expressions.length === 0) {
      emptyOrigin(state, root, context);
      return;
    }
    for (const initializer of slot.expressions) {
      dependency(
        state,
        callableExpressionState(initializer, context),
        "field",
        root,
        context,
      );
    }
    return;
  }
  if (source.ast.is.IsCallExpression(root)) {
    const call = callableCallState(root, context);
    if (call !== state) {
      dependency(state, call, "callable-invocation", root, context);
    }
    return;
  }
  expandReference(state, root, context);
}

function callableCallState(
  call: Node,
  context: CallableContext,
): CallableState {
  const existing = context.calls.get(call);
  if (existing !== undefined) {
    return existing;
  }
  const state = newState("expression", call, context);
  context.calls.set(call, state);
  state.expanded = true;
  const { source } = context;
  const semantics = source.semantics.forNode(call);
  const signature = semantics.operations.call(call)?.selectedSignature;
  const contract = signature === undefined
    ? undefined
    : semantics.declarations.signatureDeclaration(signature);
  const implementation = resolveProjectInvocation(source, call)?.implementation;
  const target = exactCallableTarget(
    source,
    source.ast.as.AsCallExpression(call)?.Expression,
  );
  const reference = source.navigation.sourceReferenceFor(target);
  const exactImplementations = context.exactCallImplementations?.(call);
  if (
    exactImplementations === undefined &&
    referenceHasExactSemantics(source, reference) &&
    reference.declaration !== implementation &&
    reference.declaration !== contract
  ) {
    dependency(
      state,
      callableDeclarationState(reference.declaration, context),
      "alias",
      target ?? call,
      context,
    );
  }
  if (implementation !== undefined && context.candidates.has(implementation)) {
    dependency(
      state,
      callableDeclarationState(implementation, context),
      "callable-invocation",
      call,
      context,
    );
    return state;
  }
  const implementations = exactImplementations ??
    (contract === undefined
      ? undefined
      : context.exactContractImplementations?.(contract));
  if (implementation === undefined && implementations !== undefined) {
    if (implementations.length === 0) {
      boundary(state, "open-callable", call, context);
      return state;
    }
    for (const selected of implementations) {
      dependency(
        state,
        callableDeclarationState(selected, context),
        "callable-invocation",
        call,
        context,
      );
    }
    return state;
  }
  const synchronous = implementation ?? contract;
  if (
    synchronous !== undefined &&
    resolvedCallUsesSynchronousTransport(source, call)
  ) {
    if (implementation === undefined) {
      synchronousOrigin(state, synchronous, context);
    } else {
      dependency(
        state,
        callableDeclarationState(synchronous, context),
        "callable-invocation",
        call,
        context,
      );
    }
    return state;
  }
  if (target === undefined) {
    boundary(state, "open-callable", call, context);
  } else {
    dependency(
      state,
      callableExpressionState(target, context),
      "callable-invocation",
      call,
      context,
    );
  }
  return state;
}

function expandReference(
  state: CallableState,
  root: Node,
  context: CallableContext,
): void {
  const { source } = context;
  const symbolNode = source.ast.is.IsPropertyAccessExpression(root)
    ? source.ast.as.AsPropertyAccessExpression(root)?.name
    : source.ast.name(root) ?? root;
  const candidate = symbolNode === undefined
    ? undefined
    : declarationForSymbols(source, context.candidateSymbols, symbolNode);
  if (candidate !== undefined) {
    recordCallableReference(root, symbolNode, state, context);
    dependency(
      state,
      callableDeclarationState(candidate, context),
      "alias",
      root,
      context,
    );
    return;
  }
  const reference = source.navigation.sourceReferenceFor(root);
  if (!referenceHasExactSemantics(source, reference)) {
    boundary(state, "inexact-reference", root, context);
    return;
  }
  if (isFunctionLike(source, reference.declaration)) {
    recordCallableReference(root, symbolNode, state, context);
  }
  const implementations = context.exactContractImplementations?.(
    reference.declaration,
  );
  if (implementations !== undefined) {
    if (implementations.length === 0) {
      boundary(state, "open-callable", root, context);
      return;
    }
    for (const implementation of implementations) {
      selectCallableOrigin(
        state,
        implementation,
        root,
        context,
      );
    }
    return;
  }
  dependency(
    state,
    callableDeclarationState(reference.declaration, context),
    "alias",
    root,
    context,
  );
}

function recordCallableReference(
  root: Node,
  symbolNode: Node | undefined,
  state: CallableState,
  context: CallableContext,
): void {
  context.callableReferences.set(root, state);
  if (symbolNode !== undefined) {
    context.callableReferences.set(symbolNode, state);
  }
}

function selectCallableOrigin(
  state: CallableState,
  declaration: Node,
  occurrence: Node,
  context: CallableContext,
): void {
  if (context.candidates.has(declaration)) {
    if (context.program.hasBindingWrite(declaration)) {
      boundary(state, "open-binding", occurrence, context);
    } else {
      candidateOrigin(state, declaration, context);
    }
  } else if (callableUsesSynchronousTransport(context.source, declaration)) {
    if (context.program.hasBindingWrite(declaration)) {
      boundary(state, "open-binding", occurrence, context);
    } else {
      synchronousOrigin(state, declaration, context);
    }
  } else {
    boundary(state, "open-callable", occurrence, context);
  }
}
