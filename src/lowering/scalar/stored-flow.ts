import type { Node } from "@tsonic/tsts";
import type { TargetSourceProgram } from "@tsonic/target-api";
import {
  AsPropertyAccessExpression,
  AsVariableDeclaration,
  AsVariableDeclarationList,
  IsIdentifier,
  IsNewExpression,
  IsVariableDeclaration,
  IsVariableDeclarationList,
  IsVariableStatement,
  NodeFlagsConst,
} from "@tsonic/tsts/target-ast";

import type { TargetProgramIndex } from "../program-index.js";

export type StoredScalarFlowRetentionReason =
  | "open-construction"
  | "open-projection"
  | "observable-instance-value";

export interface StoredScalarFlow {
  readonly constructions: readonly Node[];
  readonly projections: readonly Node[];
}

export type StoredScalarFlowResolution =
  | { readonly kind: "proved"; readonly flow: StoredScalarFlow }
  | {
      readonly kind: "retained";
      readonly reason: StoredScalarFlowRetentionReason;
    };

export function resolveStoredScalarFlow(
  source: TargetSourceProgram,
  program: TargetProgramIndex,
  constructions: readonly Node[],
  projections: readonly Node[],
  optimizedConstructions: ReadonlySet<Node>,
  optimizedProjections: ReadonlySet<Node>,
): StoredScalarFlowResolution {
  const remainingConstructions = constructions.filter(
    (node) => !optimizedConstructions.has(node),
  );
  const remainingProjections = new Set(
    projections.filter((node) => !optimizedProjections.has(node)),
  );
  if (remainingConstructions.length === 0) {
    return remainingProjections.size === 0
      ? proved([], [])
      : retained("open-projection");
  }

  const bindings = new Set<Node>();
  for (const construction of remainingConstructions) {
    const binding = constructionBinding(source, construction);
    if (binding === undefined) {
      return retained("open-construction");
    }
    if (bindingIsObservable(source, program, binding)) {
      return retained("observable-instance-value");
    }
    bindings.add(binding);
  }

  const consumedProjections = new Set<Node>();
  for (const binding of bindings) {
    for (const reference of source.navigation.referencesToDeclaration(binding)) {
      const projection = source.ast.parent(reference);
      const access = AsPropertyAccessExpression(projection);
      if (
        projection === undefined ||
        access?.Expression !== reference ||
        !remainingProjections.has(projection)
      ) {
        return retained("observable-instance-value");
      }
      consumedProjections.add(projection);
    }
  }
  if (
    consumedProjections.size !== remainingProjections.size ||
    [...remainingProjections].some((projection) => {
      const receiver = AsPropertyAccessExpression(projection)?.Expression;
      const declaration = source.navigation.sourceReferenceFor(receiver)?.declaration;
      return declaration === undefined || !bindings.has(declaration);
    })
  ) {
    return retained("open-projection");
  }
  return proved(remainingConstructions, [...remainingProjections]);
}

function constructionBinding(
  source: TargetSourceProgram,
  construction: Node,
): Node | undefined {
  if (!IsNewExpression(construction)) {
    return undefined;
  }
  const declaration = source.ast.parent(construction);
  if (!IsVariableDeclaration(declaration)) {
    return undefined;
  }
  const variable = AsVariableDeclaration(declaration);
  if (variable?.Initializer !== construction || !IsIdentifier(variable.name)) {
    return undefined;
  }
  const listNode = source.ast.parent(declaration);
  if (!IsVariableDeclarationList(listNode)) {
    return undefined;
  }
  const list = AsVariableDeclarationList(listNode);
  const statement = source.ast.parent(listNode);
  if (
    list === undefined ||
    (list.Flags & NodeFlagsConst) === 0 ||
    !IsVariableStatement(statement)
  ) {
    return undefined;
  }
  return declaration;
}

function bindingIsObservable(
  source: TargetSourceProgram,
  program: TargetProgramIndex,
  declaration: Node,
): boolean {
  if (program.bindingWritesFor(declaration).length !== 0) {
    return true;
  }
  const list = source.ast.parent(declaration);
  const statement = source.ast.parent(list);
  return statement === undefined ||
    source.ast.hasModifierKind(statement, "export") ||
    source.ast.hasModifierKind(statement, "default");
}

function proved(
  constructions: readonly Node[],
  projections: readonly Node[],
): StoredScalarFlowResolution {
  return Object.freeze({
    kind: "proved",
    flow: Object.freeze({
      constructions: Object.freeze([...constructions]),
      projections: Object.freeze([...projections]),
    }),
  });
}

function retained(
  reason: StoredScalarFlowRetentionReason,
): StoredScalarFlowResolution {
  return Object.freeze({ kind: "retained", reason });
}
