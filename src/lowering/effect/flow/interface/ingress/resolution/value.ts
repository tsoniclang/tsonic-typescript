import type { Node } from "@tsonic/tsts";
import { KindThisKeyword } from "@tsonic/tsts/target-ast";

import { callCrossesOpaqueInterfaceBoundary } from "../../transport-context.js";
import {
  classValueOriginIsClosed,
  expressionCannotSupplyImplementation,
  thisValueOriginIsClosed,
  typeHasCertifiedImplementation,
  typeProvidesContract,
} from "../origin-facts.js";
import { exactInterfaceCallResultOrigins } from "../call-results.js";
import { originDeclarationIsClosed } from "../../origin-declaration.js";
import { storageDeclarationCanBeTracked } from "../../../storage/owners.js";
import { exactAggregateRead } from "../../../aggregate/projection.js";
import type {
  OriginGraphContext,
  OriginState,
} from "../resolution.js";
import type { InterfaceOriginExpansion } from "./expansion.js";

export function expandInterfaceOriginValue(
  state: OriginState,
  expression: Node,
  context: OriginGraphContext,
  flow: InterfaceOriginExpansion,
): void {
  const { ingress, contract } = context;
  if (expressionCannotSupplyImplementation(expression, ingress)) {
    flow.origin(state, expression, context);
    return;
  }
  if (ingress.source.ast.kind(expression) === KindThisKeyword) {
    flow.terminal(
      state,
      thisValueOriginIsClosed(expression, contract, ingress),
      expression,
      context,
    );
    return;
  }
  if (
    ingress.source.ast.is.IsObjectLiteralExpression(expression) ||
    ingress.source.ast.is.IsArrayLiteralExpression(expression) ||
    ingress.source.ast.is.IsClassExpression(expression)
  ) {
    const semantics = ingress.source.semantics.forNode(expression);
    const type = semantics.types.expressionType(expression);
    if (
      type !== undefined &&
      typeProvidesContract(semantics, type, contract, ingress)
    ) {
      flow.origin(state, expression, context);
      return;
    }
  }
  if (
    flow.expandSlotProjection(state, expression, "value", context) ||
    flow.expandCompositeAlternatives(
      state,
      expression,
      "value",
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
        "value",
        "field",
        expression,
        context,
      );
    }
    return;
  }
  if (ingress.source.ast.is.IsPropertyAccessExpression(expression)) {
    expandPropertyRead(state, expression, context, flow);
    return;
  }
  if (ingress.source.ast.is.IsElementAccessExpression(expression)) {
    expandElementRead(state, expression, context, flow);
    return;
  }
  if (ingress.source.ast.is.IsNewExpression(expression)) {
    const semantics = ingress.source.semantics.forNode(expression);
    const call = semantics.operations.call(expression);
    const declaration = call === undefined
      ? undefined
      : semantics.declarations.signatureDeclaration(call.selectedSignature) ??
        ingress.source.navigation.declarationFor(expression);
    const type = semantics.types.expressionType(expression);
    flow.terminal(
      state,
      originDeclarationIsClosed(ingress.source, declaration) &&
        type !== undefined &&
        typeProvidesContract(semantics, type, contract, ingress),
      expression,
      context,
    );
    return;
  }
  if (ingress.source.ast.is.IsCallExpression(expression)) {
    expandValueCall(state, expression, context, flow);
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
  if (!ingress.source.ast.is.IsIdentifier(expression)) {
    flow.boundary(state, "unproven-value-origin", expression, context);
    return;
  }
  expandValueIdentifier(state, expression, context, flow);
}

function expandPropertyRead(
  state: OriginState,
  expression: Node,
  context: OriginGraphContext,
  flow: InterfaceOriginExpansion,
): void {
  const { ingress, contract } = context;
  const access = ingress.source.ast.as.AsPropertyAccessExpression(expression);
  const semantics = ingress.source.semantics.forNode(expression);
  const declaration = semantics.operations.propertyAccess(expression)
    ?.selectedDeclaration;
  const type = semantics.types.expressionType(expression);
  const trackedStorage = declaration !== undefined &&
    storageDeclarationCanBeTracked(ingress.source, declaration);
  const slot = ingress.slots?.resultFor(expression);
  if (
    declaration === undefined ||
    (!trackedStorage && slot !== undefined && !slot.closed) ||
    (trackedStorage
      ? !flow.storageDeclarationIsClosed(declaration, context)
      : !originDeclarationIsClosed(ingress.source, declaration)) ||
    type === undefined ||
    !typeProvidesContract(semantics, type, contract, ingress) ||
    access?.Expression === undefined
  ) {
    flow.boundary(state, "unproven-value-origin", expression, context);
    return;
  }
  if (trackedStorage) {
    flow.declarationDependency(
      state,
      declaration,
      "value",
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
}

function expandElementRead(
  state: OriginState,
  expression: Node,
  context: OriginGraphContext,
  flow: InterfaceOriginExpansion,
): void {
  const { ingress, contract } = context;
  const semantics = ingress.source.semantics.forNode(expression);
  const access = semantics.operations.elementAccess(expression);
  const owner = ingress.source.ast.as.AsElementAccessExpression(expression)
    ?.Expression;
  const type = access?.sourceReadType ?? semantics.types.expressionType(expression);
  const declaration = access?.selectedDeclaration;
  const trackedStorage = declaration !== undefined &&
    storageDeclarationCanBeTracked(ingress.source, declaration);
  const slot = ingress.slots?.resultFor(expression);
  if (
    access === undefined ||
    access.accessMode !== "read" ||
    owner === undefined ||
    access.receiver.expression !== owner ||
    type === undefined ||
    !typeProvidesContract(semantics, type, contract, ingress)
  ) {
    flow.boundary(state, "unproven-value-origin", expression, context);
    return;
  }
  const aggregateRead = exactAggregateRead(ingress.source, expression);
  const aggregateReference = aggregateRead === undefined ||
      !ingress.source.ast.is.IsIdentifier(aggregateRead.receiver)
    ? undefined
    : ingress.source.navigation.sourceReferenceFor(aggregateRead.receiver);
  const restInputs = aggregateRead !== undefined &&
      aggregateReference?.project === true &&
      ingress.source.ast.is.IsParameterDeclaration(
        aggregateReference.declaration,
      )
    ? ingress.invocationInputs.restElementInputsFor(
      aggregateReference.declaration,
      aggregateRead.index,
    )
    : undefined;
  if (restInputs !== undefined) {
    if (restInputs.length === 0) {
      flow.origin(state, expression, context);
    } else {
      for (const input of restInputs) {
        flow.dependency(
          state,
          input,
          "value",
          "element",
          expression,
          context,
        );
      }
    }
    return;
  }
  if (!trackedStorage && slot !== undefined && !slot.closed) {
    flow.boundary(state, "unproven-value-origin", expression, context);
    return;
  }
  if (trackedStorage && flow.storageDeclarationIsClosed(declaration, context)) {
    flow.declarationDependency(
      state,
      declaration,
      "value",
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
}

function expandValueCall(
  state: OriginState,
  expression: Node,
  context: OriginGraphContext,
  flow: InterfaceOriginExpansion,
): void {
  const { ingress, contract } = context;
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
        "value",
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
        "value",
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
    call !== undefined && declaration !== undefined &&
      (
        !callCrossesOpaqueInterfaceBoundary(
          ingress.source,
          declaration,
          ingress.entries,
        ) || typeHasCertifiedImplementation(
          semantics,
          call.sourceResultType,
          contract,
          ingress,
        )
      ),
    expression,
    context,
    "opaque-call-transport",
  );
}

function expandValueIdentifier(
  state: OriginState,
  expression: Node,
  context: OriginGraphContext,
  flow: InterfaceOriginExpansion,
): void {
  const { ingress, contract } = context;
  const refinement = ingress.source.semantics.selectValueTypeRefinement(
    expression,
  );
  if (refinement.kind !== "resolved") {
    const reference = ingress.source.navigation.sourceReferenceFor(expression);
    const semantics = ingress.source.semantics.forNode(expression);
    const type = semantics.types.expressionType(expression);
    const sourceFile = reference === undefined
      ? undefined
      : ingress.source.ast.getSourceFile(reference.declaration);
    flow.terminal(
      state,
      reference !== undefined &&
        sourceFile !== undefined &&
        ingress.source.ast.isDeclarationFile(sourceFile) &&
        type !== undefined &&
        typeHasCertifiedImplementation(
          semantics,
          type,
          contract,
          ingress,
        ),
      expression,
      context,
    );
    return;
  }
  if (ingress.opaqueInputs.has(refinement.reference.declaration)) {
    flow.boundary(state, "opaque-call-transport", expression, context);
    return;
  }
  if (!originDeclarationIsClosed(
    ingress.source,
    refinement.reference.declaration,
  )) {
    flow.boundary(state, "unproven-value-origin", expression, context);
    return;
  }
  const semantics = ingress.source.semantics.forNode(expression);
  if (
    ingress.source.ast.is.IsClassDeclaration(refinement.reference.declaration) ||
    ingress.source.ast.is.IsClassExpression(refinement.reference.declaration)
  ) {
    flow.terminal(
      state,
      classValueOriginIsClosed(
        semantics,
        refinement.declaredType,
        contract,
        ingress,
      ),
      expression,
      context,
    );
    return;
  }
  if (!typeProvidesContract(
    semantics,
    refinement.declaredType,
    contract,
    ingress,
  )) {
    flow.boundary(state, "unproven-value-origin", expression, context);
    return;
  }
  flow.expandDeclaration(
    state,
    refinement.reference.declaration,
    "value",
    expression,
    context,
  );
}
