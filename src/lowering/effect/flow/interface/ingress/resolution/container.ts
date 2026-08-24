import type { Node } from "@tsonic/tsts";
import { KindThisKeyword } from "@tsonic/tsts/target-ast";

import { callCrossesOpaqueInterfaceBoundary } from "../../transport-context.js";
import { exactInterfaceCallResultOrigins } from "../call-results.js";
import {
  originDeclarationIsClosed,
  propertyValueIsReceiverIndependent,
} from "../../origin-declaration.js";
import { storageDeclarationCanBeTracked } from "../../../storage/owners.js";
import type {
  OriginGraphContext,
  OriginState,
} from "../resolution.js";
import type { InterfaceOriginExpansion } from "./expansion.js";
import { sourceBodyInspectionIsExact } from "../../../../model/source-membership.js";
import { sourceValueReference } from "../../../../model/exact-source-invocation.js";

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
      context.facts.valueContainerIsClosed(expression),
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
      .operations.propertyAccess(expression)?.selectedDeclaration;
    const trackedStorage = declaration !== undefined &&
      storageDeclarationCanBeTracked(ingress.source, declaration);
    const slot = ingress.slots?.resultFor(expression);
    if (
      declaration === undefined ||
      access?.Expression === undefined ||
      (!trackedStorage && slot !== undefined && !slot.closed) ||
      (trackedStorage
        ? !flow.storageDeclarationIsClosed(declaration, context)
        : !originDeclarationIsClosed(
            ingress.source,
            declaration,
            ingress.bodyInspectionIsCertified,
          ))
    ) {
      flow.boundary(state, "unproven-value-origin", expression, context);
      return;
    }
    if (
      propertyValueIsReceiverIndependent(
        ingress.source,
        access.Expression,
        declaration,
      )
    ) {
      flow.declarationDependency(
        state,
        declaration,
        "container",
        "field",
        expression,
        context,
      );
    } else if (trackedStorage) {
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
      .operations.elementAccess(expression)?.selectedDeclaration;
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
      declaration !== undefined &&
      originDeclarationIsClosed(
        ingress.source,
        declaration,
        ingress.bodyInspectionIsCertified,
      ) &&
      propertyValueIsReceiverIndependent(
        ingress.source,
        owner,
        declaration,
      )
    ) {
      flow.declarationDependency(
        state,
        declaration,
        "container",
        "element",
        expression,
        context,
      );
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
    flow.terminal(
      state,
      sourceBodyInspectionIsExact(
        ingress.source,
        expression,
        ingress.bodyInspectionIsCertified,
      ),
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
    const call = semantics.operations.call(expression);
    const declaration = call === undefined
      ? ingress.source.navigation.declarationFor(expression)
      : semantics.declarations.signatureDeclaration(call.selectedSignature) ??
        call.sourceCalleeAccess?.selectedDeclaration ??
        call.sourceCallee.selectedDeclaration ??
        ingress.source.navigation.declarationFor(expression);
    flow.terminal(
      state,
      originDeclarationIsClosed(
        ingress.source,
        declaration,
        ingress.bodyInspectionIsCertified,
      ),
      expression,
      context,
    );
    return;
  }
  if (!ingress.source.ast.is.IsIdentifier(expression)) {
    flow.boundary(state, "unproven-value-origin", expression, context);
    return;
  }
  const reference = sourceValueReference(ingress.source, expression);
  if (reference !== undefined && ingress.opaqueInputs.has(reference.declaration)) {
    flow.boundary(state, "opaque-call-transport", expression, context);
    return;
  }
  if (!originDeclarationIsClosed(
    ingress.source,
    reference?.declaration,
    ingress.bodyInspectionIsCertified,
  )) {
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
  const origins = ingress.transports?.transportFor(expression)
    ?.resultOriginExpressions;
  if (origins !== undefined) {
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
    if (projectOrigins.length === 0) {
      flow.origin(state, expression, context);
      return;
    }
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
  const call = semantics.operations.call(expression);
  const declaration = call === undefined
    ? undefined
    : semantics.declarations.signatureDeclaration(call.selectedSignature);
  flow.terminal(
    state,
    call !== undefined &&
      declaration !== undefined &&
      !callCrossesOpaqueInterfaceBoundary(
        ingress.source,
        declaration,
        ingress.entries,
        ingress.bodyInspectionIsCertified,
      ) &&
      context.facts.valueContainerIsClosed(expression),
    expression,
    context,
    "opaque-call-transport",
  );
}
