import type { Node, Type } from "@tsonic/tsts";
import type {
  SourceFileSemantics,
  TargetSourceProgram,
} from "@tsonic/target-api/source";
import {
  KindCallExpression,
  KindElementAccessExpression,
  KindIdentifier,
  KindPropertyAccessExpression,
} from "@tsonic/tsts/target-ast";

import type { TargetProgramIndex } from "../../../program-index.js";
import { exactCallableTarget } from "../../model/syntax.js";

const projectionKinds = Object.freeze([
  KindElementAccessExpression,
  KindIdentifier,
  KindPropertyAccessExpression,
]);

export function collectCallableProjectionCandidates(
  source: TargetSourceProgram,
  program: TargetProgramIndex,
): readonly Node[] {
  const invokedTargets = new Set<Node>();
  for (const call of program.nodesOfKind(KindCallExpression)) {
    const target = exactCallableTarget(
      source,
      source.ast.as.AsCallExpression(call)?.Expression,
    );
    if (target !== undefined) {
      invokedTargets.add(target);
    }
  }
  const callableTypes = new WeakMap<Type, boolean>();
  return Object.freeze(program.nodesOfKinds(projectionKinds).filter((node) =>
    invokedTargets.has(node) || expressionMayContainCallable(
      source.semantics.forNode(node),
      node,
      callableTypes,
    )
  ));
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
