import type { Node } from "@tsonic/tsts";
import { KindThisKeyword } from "@tsonic/tsts/target-ast";

import { exactInterfaceCallResultOrigins } from "../call-results.js";
import {
  originDeclarationIsClosed,
  propertyValueIsReceiverIndependent,
} from "../../origin-declaration.js";
import { storageDeclarationCanBeTracked } from "../../../storage/owners.js";
import { exactAggregateRead } from "../../../aggregate/projection.js";
import type {
  OriginGraphContext,
  OriginState,
} from "../resolution.js";
import type { InterfaceOriginExpansion } from "./expansion.js";
import {
  sourceBodyInspectionIsExact,
} from "../../../../model/source-membership.js";
import { expandValueIdentifier } from "./value/identifier.js";
import { exactStructuralCallResultTypes } from "../structural-call-result.js";

export function expandInterfaceOriginValue(
  state: OriginState,
  expression: Node,
  context: OriginGraphContext,
  flow: InterfaceOriginExpansion,
): void {
  const { ingress } = context;
  if (context.facts.expressionCannotSupplyImplementation(expression)) {
    flow.origin(state, expression, context);
    return;
  }
  if (ingress.source.ast.kind(expression) === KindThisKeyword) {
    const closed = context.domain.select(
      context.active,
      (contract) => context.facts.thisValueIsClosed(expression, contract),
    );
    flow.terminalForContracts(
      state,
      closed,
      expression,
      context,
    );
    return;
  }
  let activeContext = context;
  if (
    ingress.source.ast.is.IsObjectLiteralExpression(expression) ||
    ingress.source.ast.is.IsArrayLiteralExpression(expression) ||
    ingress.source.ast.is.IsClassExpression(expression)
  ) {
    const semantics = ingress.source.semantics.forNode(expression);
    const type = semantics.types.expressionType(expression);
    if (type !== undefined) {
      const provided = context.domain.select(
        context.active,
        (contract) => context.facts.typeProvidesContract(
          semantics,
          type,
          contract,
        ),
      );
      flow.origin(state, expression, context, provided);
      const remaining = context.domain.subtract(context.active, provided);
      if (context.domain.isEmpty(remaining)) {
        return;
      }
      activeContext = { ...context, active: remaining };
    }
  }
  if (
    flow.expandSlotProjection(state, expression, "value", activeContext) ||
    flow.expandCompositeAlternatives(
      state,
      expression,
      "value",
      expression,
      activeContext,
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
        activeContext,
      );
    }
    return;
  }
  if (ingress.source.ast.is.IsPropertyAccessExpression(expression)) {
    expandPropertyRead(state, expression, activeContext, flow);
    return;
  }
  if (ingress.source.ast.is.IsElementAccessExpression(expression)) {
    expandElementRead(state, expression, activeContext, flow);
    return;
  }
  if (ingress.source.ast.is.IsNewExpression(expression)) {
    const semantics = ingress.source.semantics.forNode(expression);
    const call = semantics.operations.call(expression);
    const declaration = call === undefined
      ? undefined
      : semantics.declarations.signatureDeclaration(call.selectedSignature) ??
        call.sourceCalleeAccess?.selectedDeclaration ??
        call.sourceCallee.selectedDeclaration ??
        ingress.source.navigation.declarationFor(expression);
    const type = semantics.types.expressionType(expression);
    let closed = activeContext.domain.empty();
    if (
      originDeclarationIsClosed(
        ingress.source,
        declaration,
        ingress.bodyInspectionIsCertified,
      ) &&
      type !== undefined
    ) {
      closed = activeContext.domain.select(
        activeContext.active,
        (contract) => activeContext.facts.typeProvidesContract(
          semantics,
          type,
          contract,
        ),
      );
    }
    flow.terminalForContracts(
      state,
      closed,
      expression,
      activeContext,
    );
    return;
  }
  if (ingress.source.ast.is.IsCallExpression(expression)) {
    expandValueCall(state, expression, activeContext, flow);
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
      activeContext,
    );
    return;
  }
  if (!ingress.source.ast.is.IsIdentifier(expression)) {
    flow.boundary(
      state,
      "unproven-value-origin",
      expression,
      activeContext,
    );
    return;
  }
  expandValueIdentifier(state, expression, activeContext, flow);
}

function expandPropertyRead(
  state: OriginState,
  expression: Node,
  context: OriginGraphContext,
  flow: InterfaceOriginExpansion,
): void {
  const { ingress } = context;
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
      : !originDeclarationIsClosed(
          ingress.source,
          declaration,
          ingress.bodyInspectionIsCertified,
        )) ||
    type === undefined ||
    access?.Expression === undefined
  ) {
    flow.boundary(state, "unproven-value-origin", expression, context);
    return;
  }
  const provided = context.domain.select(
    context.active,
    (contract) => context.facts.typeProvidesContract(
      semantics,
      type,
      contract,
    ),
  );
  flow.boundary(
    state,
    "unproven-value-origin",
    expression,
    context,
    context.domain.subtract(context.active, provided),
  );
  if (context.domain.isEmpty(provided)) {
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
      "value",
      "field",
      expression,
      context,
      provided,
    );
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
      provided,
    );
    flow.dependency(
      state,
      access.Expression,
      "container",
      "field",
      expression,
      context,
      provided,
    );
  } else {
    flow.dependency(
      state,
      access.Expression,
      "container",
      "field",
      expression,
      context,
      provided,
    );
  }
}

function expandElementRead(
  state: OriginState,
  expression: Node,
  context: OriginGraphContext,
  flow: InterfaceOriginExpansion,
): void {
  const { ingress } = context;
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
    type === undefined
  ) {
    flow.boundary(state, "unproven-value-origin", expression, context);
    return;
  }
  const provided = context.domain.select(
    context.active,
    (contract) => context.facts.typeProvidesContract(
      semantics,
      type,
      contract,
    ),
  );
  flow.boundary(
    state,
    "unproven-value-origin",
    expression,
    context,
    context.domain.subtract(context.active, provided),
  );
  if (context.domain.isEmpty(provided)) {
    return;
  }
  const aggregateRead = exactAggregateRead(ingress.source, expression);
  const aggregateReference = aggregateRead === undefined ||
      !ingress.source.ast.is.IsIdentifier(aggregateRead.receiver)
    ? undefined
    : ingress.source.navigation.sourceReferenceFor(aggregateRead.receiver);
  const restInputs = aggregateRead !== undefined &&
      aggregateReference !== undefined &&
      sourceBodyInspectionIsExact(
        ingress.source,
        aggregateReference.declaration,
        ingress.bodyInspectionIsCertified,
      ) &&
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
      flow.origin(state, expression, context, provided);
    } else {
      for (const input of restInputs) {
        flow.dependency(
          state,
          input,
          "value",
          "element",
          expression,
          context,
          provided,
        );
      }
    }
    return;
  }
  if (!trackedStorage && slot !== undefined && !slot.closed) {
    flow.boundary(
      state,
      "unproven-value-origin",
      expression,
      context,
      provided,
    );
    return;
  }
  if (
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
      "value",
      "element",
      expression,
      context,
      provided,
    );
  } else if (
    trackedStorage &&
    flow.storageDeclarationIsClosed(declaration, context)
  ) {
    flow.declarationDependency(
      state,
      declaration,
      "value",
      "element",
      expression,
      context,
      provided,
    );
  } else {
    flow.dependency(
      state,
      owner,
      "container",
      "element",
      expression,
      context,
      provided,
    );
  }
}

function expandValueCall(
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
    if (projectOrigins.length === 0) {
      flow.origin(state, expression, context);
      return;
    }
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
  const structuralResults = exactStructuralCallResultTypes(expression, ingress);
  if (structuralResults !== undefined) {
    const closed = context.domain.select(
      context.active,
      (contract) => structuralResults.every((result) =>
        context.facts.typeHasCertifiedImplementation(
          result.semantics,
          result.type,
          contract,
        )
      ),
    );
    flow.terminalForContracts(
      state,
      closed,
      expression,
      context,
      "opaque-call-transport",
    );
    return;
  }
  const semantics = ingress.source.semantics.forNode(expression);
  const call = semantics.operations.call(expression);
  const declaration = call === undefined
    ? undefined
    : semantics.declarations.signatureDeclaration(call.selectedSignature);
  let closed = context.domain.empty();
  if (call !== undefined && declaration !== undefined) {
    closed = context.domain.select(
      context.active,
      (contract) => context.facts.typeHasCertifiedImplementation(
        semantics,
        call.sourceResultType,
        contract,
      ),
    );
  }
  flow.terminalForContracts(
    state,
    closed,
    expression,
    context,
    "opaque-call-transport",
  );
}
