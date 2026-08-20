import type { Node } from "@tsonic/tsts";
import { KindThisKeyword } from "@tsonic/tsts/target-ast";

import { callCrossesOpaqueInterfaceBoundary } from "../../transport-context.js";
import { exactInterfaceCallResultOrigins } from "../call-results.js";
import {
  thisContainerOriginIsClosed,
} from "../origin-facts.js";
import { originDeclarationIsClosed } from "../../origin-declaration.js";
import { storageDeclarationCanBeTracked } from "../../../storage/owners.js";
import type {
  OriginGraphContext,
  OriginState,
} from "../resolution.js";
import type { InterfaceOriginExpansion } from "./expansion.js";

export function expandInterfaceOriginContainer(
  state: OriginState,
  expression: Node,
  context: OriginGraphContext,
  flow: InterfaceOriginExpansion,
): void {
  const { ingress } = context;
  if (ingress.source.ast.kind(expression) === KindThisKeyword) {
    flow.terminal(
      state,
      thisContainerOriginIsClosed(expression, ingress),
      expression,
      context,
    );
    return;
  }
  if (
    flow.expandSlotProjection(state, expression, "container", context) ||
    flow.expandCompositeAlternatives(
      state,
      expression,
      "container",
      expression,
      context,
    )
  ) {
    return;
  }
  const objectProperty = ingress.objectProjections.projectionFor(expression);
  if (objectProperty !== undefined) {
    for (const initializer of objectProperty.initializers) {
      flow.dependency(
        state,
        initializer,
        "container",
        "field",
        expression,
        context,
      );
    }
    return;
  }
  if (ingress.source.ast.is.IsPropertyAccessExpression(expression)) {
    const access = ingress.source.ast.as.AsPropertyAccessExpression(expression);
    const declaration = ingress.source.semantics.forNode(expression)
      .getResolvedPropertyAccessInfo(expression)?.selectedDeclaration;
    const trackedStorage = declaration !== undefined &&
      storageDeclarationCanBeTracked(ingress.source, declaration);
    const slot = ingress.slots?.resultFor(expression);
    if (
      declaration === undefined ||
      access?.Expression === undefined ||
      (!trackedStorage && slot !== undefined && !slot.closed) ||
      (trackedStorage
        ? !flow.storageDeclarationIsClosed(declaration, context)
        : !originDeclarationIsClosed(ingress.source, declaration))
    ) {
      flow.boundary(state, "unproven-value-origin", expression, context);
      return;
    }
    if (trackedStorage) {
      flow.declarationDependency(
        state,
        declaration,
        "container",
        "field",
        expression,
        context,
      );
      flow.dependency(
        state,
        access.Expression,
        "container",
        "field",
        expression,
        context,
      );
    } else {
      flow.dependency(
        state,
        access.Expression,
        "container",
        "field",
        expression,
        context,
      );
    }
    return;
  }
  if (ingress.source.ast.is.IsElementAccessExpression(expression)) {
    const declaration = ingress.source.semantics.forNode(expression)
      .getResolvedElementAccessInfo(expression)?.selectedDeclaration;
    const trackedStorage = declaration !== undefined &&
      storageDeclarationCanBeTracked(ingress.source, declaration);
    const slot = ingress.slots?.resultFor(expression);
    const owner = ingress.source.ast.as.AsElementAccessExpression(expression)
      ?.Expression;
    if (
      owner === undefined ||
      (!trackedStorage && slot !== undefined && !slot.closed)
    ) {
      flow.boundary(state, "unproven-value-origin", expression, context);
    } else if (
      trackedStorage && flow.storageDeclarationIsClosed(declaration, context)
    ) {
      flow.declarationDependency(
        state,
        declaration,
        "container",
        "element",
        expression,
        context,
      );
      flow.dependency(
        state,
        owner,
        "container",
        "element",
        expression,
        context,
      );
    } else {
      flow.dependency(
        state,
        owner,
        "container",
        "element",
        expression,
        context,
      );
    }
    return;
  }
  if (
    ingress.source.ast.is.IsArrowFunction(expression) ||
    ingress.source.ast.is.IsFunctionExpression(expression)
  ) {
    const sourceFile = ingress.source.ast.getSourceFile(expression);
    flow.terminal(
      state,
      sourceFile !== undefined && ingress.source.semantics.includes(sourceFile),
      expression,
      context,
    );
    return;
  }
  if (ingress.source.ast.is.IsCallExpression(expression)) {
    expandContainerCall(state, expression, context, flow);
    return;
  }
  if (ingress.source.ast.is.IsNewExpression(expression)) {
    const semantics = ingress.source.semantics.forNode(expression);
    const call = semantics.getResolvedCallInfo(expression);
    const declaration = call === undefined
      ? ingress.source.navigation.declarationFor(expression)
      : semantics.getSignatureDeclaration(call.selectedSignature) ??
        ingress.source.navigation.declarationFor(expression);
    flow.terminal(
      state,
      originDeclarationIsClosed(ingress.source, declaration),
      expression,
      context,
    );
    return;
  }
  if (!ingress.source.ast.is.IsIdentifier(expression)) {
    flow.boundary(state, "unproven-value-origin", expression, context);
    return;
  }
  const reference = ingress.program.declarationReferenceFor(expression);
  if (reference !== undefined && ingress.opaqueInputs.has(reference.declaration)) {
    flow.boundary(state, "opaque-call-transport", expression, context);
    return;
  }
  if (!originDeclarationIsClosed(ingress.source, reference?.declaration)) {
    flow.boundary(state, "unproven-value-origin", expression, context);
    return;
  }
  flow.expandDeclaration(
    state,
    reference.declaration,
    "container",
    expression,
    context,
  );
}

function expandContainerCall(
  state: OriginState,
  expression: Node,
  context: OriginGraphContext,
  flow: InterfaceOriginExpansion,
): void {
  const { ingress } = context;
  const transport = ingress.transports?.transportFor(expression);
  if (transport !== undefined) {
    const origins = transport.resultOriginExpressions;
    if (origins === undefined) {
      flow.boundary(state, "opaque-call-transport", expression, context);
      return;
    }
    if (origins.length === 0) {
      flow.origin(state, expression, context);
      return;
    }
    for (const input of origins) {
      flow.dependency(
        state,
        input,
        "container",
        "provider-transport",
        expression,
        context,
      );
    }
    return;
  }
  const projectOrigins = exactInterfaceCallResultOrigins(expression, ingress);
  if (projectOrigins !== undefined) {
    for (const input of projectOrigins) {
      flow.dependency(
        state,
        input,
        "container",
        "return",
        expression,
        context,
      );
    }
    return;
  }
  const semantics = ingress.source.semantics.forNode(expression);
  const call = semantics.getResolvedCallInfo(expression);
  const declaration = call === undefined
    ? undefined
    : semantics.getSignatureDeclaration(call.selectedSignature);
  flow.terminal(
    state,
    declaration !== undefined &&
      !callCrossesOpaqueInterfaceBoundary(
        ingress.source,
        declaration,
        ingress.entries,
      ),
    expression,
    context,
    "opaque-call-transport",
  );
}
