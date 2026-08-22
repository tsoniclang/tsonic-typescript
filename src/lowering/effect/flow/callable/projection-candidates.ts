import type { Node, Type } from "@tsonic/tsts";
import type {
  SourceFileSemantics,
  TargetSourceProgram,
} from "@tsonic/target-api/source";
import {
  KindBindingElement,
  KindCallExpression,
  KindElementAccessExpression,
  KindPropertyAccessExpression,
  KindVariableDeclaration,
} from "@tsonic/tsts/target-ast";

import type { TargetProgramIndex } from "../../../program-index.js";
import type { TypeScriptPlanningObserver } from "../../../planning-observer.js";
import { exactCallableTarget } from "../../model/syntax.js";

const projectionAccessKinds = Object.freeze([
  KindElementAccessExpression,
  KindPropertyAccessExpression,
]);

const projectionBindingKinds = Object.freeze([
  KindBindingElement,
  KindVariableDeclaration,
]);

export function collectCallableProjectionCandidates(
  source: TargetSourceProgram,
  program: TargetProgramIndex,
  planningObserver?: TypeScriptPlanningObserver,
): readonly Node[] {
  const candidates = new Set<Node>();
  for (const call of program.nodesOfKind(KindCallExpression)) {
    const target = exactCallableTarget(
      source,
      source.ast.as.AsCallExpression(call)?.Expression,
    );
    if (target !== undefined) {
      candidates.add(target);
    }
  }
  planningObserver?.("effect-projection-candidate-calls");
  const callableTypes = new WeakMap<Type, boolean>();
  for (const expression of program.nodesOfKinds(projectionAccessKinds)) {
    if (expressionMayContainCallable(
      source.semantics.forNode(expression),
      expression,
      callableTypes,
    )) {
      candidates.add(expression);
    }
  }
  planningObserver?.("effect-projection-candidate-accesses");
  for (const declaration of program.nodesOfKinds(projectionBindingKinds)) {
    const name = source.ast.name(declaration);
    if (
      name === undefined ||
      !expressionMayContainCallable(
        source.semantics.forNode(name),
        name,
        callableTypes,
      )
    ) {
      continue;
    }
    for (const reference of source.navigation.referencesToDeclaration(declaration)) {
      candidates.add(reference);
    }
  }
  planningObserver?.("effect-projection-candidate-bindings");
  const ordered = Object.freeze(
    program.nodes.filter((node) => candidates.has(node)),
  );
  planningObserver?.("effect-projection-candidate-order", {
    candidates: ordered.length,
  });
  return ordered;
}

function expressionMayContainCallable(
  semantics: SourceFileSemantics,
  expression: Node,
  cache: WeakMap<Type, boolean>,
): boolean {
  const type = semantics.types.expressionType(expression);
  return type !== undefined && typeMayContainCallable(
    semantics,
    type,
    cache,
    new Set(),
  );
}

function typeMayContainCallable(
  semantics: SourceFileSemantics,
  type: Type,
  cache: WeakMap<Type, boolean>,
  pending: Set<Type>,
): boolean {
  const existing = cache.get(type);
  if (existing !== undefined) {
    return existing;
  }
  if (pending.has(type)) {
    return false;
  }
  if (semantics.types.callSignatures(type).length !== 0) {
    cache.set(type, true);
    return true;
  }
  if (!semantics.types.isUnion(type) && !semantics.types.isIntersection(type)) {
    cache.set(type, false);
    return false;
  }
  pending.add(type);
  const callable = semantics.types.unionOrIntersectionTypes(type).some((member) =>
    member !== undefined && typeMayContainCallable(
      semantics,
      member,
      cache,
      pending,
    )
  );
  pending.delete(type);
  cache.set(type, callable);
  return callable;
}
