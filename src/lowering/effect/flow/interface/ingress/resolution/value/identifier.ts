import type { Node, Type } from "@tsonic/tsts";
import type { SourceFileSemantics } from "@tsonic/target-api/source";

import { sourceValueReference } from "../../../../../model/exact-source-invocation.js";
import { originDeclarationIsClosed } from "../../../origin-declaration.js";
import type {
  OriginGraphContext,
  OriginState,
} from "../../resolution.js";
import type { InterfaceOriginExpansion } from "../expansion.js";

export function expandValueIdentifier(
  state: OriginState,
  expression: Node,
  context: OriginGraphContext,
  flow: InterfaceOriginExpansion,
): void {
  const { ingress } = context;
  const exactReference = sourceValueReference(ingress.source, expression);
  const refinement = ingress.source.semantics.selectValueTypeRefinement(
    expression,
  );
  if (refinement.kind === "unresolved") {
    const declaration = refinement.reference.declaration;
    const expressionSemantics = ingress.source.semantics.forNode(expression);
    const selectedSemantics = refinement.missing === "declared-type"
      ? expressionSemantics
      : ingress.source.semantics.forNode(declaration);
    const selected = refinement.missing === "declared-type"
      ? expressionSemantics.types.expressionType(expression)
      : selectedSemantics.declarations.declaredValueType(declaration);
    expandExactReference(
      state,
      expression,
      declaration,
      selectedSemantics,
      selected,
      context,
      flow,
    );
    return;
  }
  if (refinement.kind === "not-project-reference") {
    const reference = exactReference;
    const semantics = ingress.source.semantics.forNode(expression);
    const type = semantics.types.expressionType(expression);
    if (
      reference !== undefined &&
      originDeclarationIsClosed(
        ingress.source,
        reference.declaration,
        ingress.bodyInspectionIsCertified,
      )
    ) {
      expandExactReference(
        state,
        expression,
        reference.declaration,
        semantics,
        type,
        context,
        flow,
      );
      return;
    }
    const sourceFile = reference === undefined
      ? undefined
      : ingress.source.ast.getSourceFile(reference.declaration);
    const closed = sourceFile !== undefined &&
        ingress.source.ast.isDeclarationFile(sourceFile) &&
        type !== undefined
      ? context.domain.select(
          context.active,
          (contract) => context.facts.typeHasCertifiedImplementation(
            semantics,
            type,
            contract,
          ),
        )
      : context.domain.empty();
    flow.terminalForContracts(state, closed, expression, context);
    return;
  }
  expandExactReference(
    state,
    expression,
    refinement.reference.declaration,
    ingress.source.semantics.forNode(expression),
    refinement.declaredType,
    context,
    flow,
  );
}

function expandExactReference(
  state: OriginState,
  expression: Node,
  declaration: Node,
  semantics: SourceFileSemantics,
  type: Type | undefined,
  context: OriginGraphContext,
  flow: InterfaceOriginExpansion,
): void {
  const { ingress } = context;
  if (ingress.opaqueInputs.has(declaration)) {
    flow.boundary(state, "opaque-call-transport", expression, context);
    return;
  }
  if (
    type === undefined ||
    !originDeclarationIsClosed(
      ingress.source,
      declaration,
      ingress.bodyInspectionIsCertified,
    )
  ) {
    flow.boundary(state, "unproven-value-origin", expression, context);
    return;
  }
  if (
    ingress.source.ast.is.IsClassDeclaration(declaration) ||
    ingress.source.ast.is.IsClassExpression(declaration)
  ) {
    const closed = context.domain.select(
      context.active,
      (contract) => context.facts.classValueIsClosed(
        semantics,
        type,
        contract,
      ),
    );
    flow.terminalForContracts(state, closed, expression, context);
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
  if (!context.domain.isEmpty(provided)) {
    flow.expandDeclaration(
      state,
      declaration,
      "value",
      expression,
      { ...context, active: provided },
    );
  }
}
