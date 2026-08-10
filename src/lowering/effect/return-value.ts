import type { Node } from "@tsonic/tsts";
import type { TargetSourceProgram } from "@tsonic/target-api";

import type { LoweredValueContract } from "../value-contract.js";
import {
  createTypeScriptRuntimeReturnContract,
  type TypeScriptRuntimeReturnContract,
} from "../../runtime/return-contract.js";
import {
  objectLiteralIsDefinitelyNonThenable,
  projectConstructionIsDefinitelyNonThenable,
} from "./return-construction.js";
import {
  createReturnCallFlow,
  type ReturnCallFlow,
  type ReturnProofScope,
  type ReturnProofValue,
} from "./return-call.js";
import {
  createReturnLocalFlow,
  type ReturnLocalFlow,
} from "./return-local.js";
import {
  createReturnProjectionFlow,
  type ReturnProjectionFlow,
} from "./return-projection.js";
import {
  createReturnStorageFlow,
  type ReturnStorageFlow,
} from "./return-storage.js";
import {
  collectProgramNodes,
  transparentExpression,
} from "./syntax.js";
import { typeExposesCallableThen } from "./synchronous.js";

export interface ReturnValueFlow {
  isDefinitelyNonThenable(expression: Node): boolean;
  callResultIsDefinitelyNonThenable(
    call: Node,
    declarations: readonly Node[],
  ): boolean;
}

export function createReturnValueFlow(
  source: TargetSourceProgram,
  directCallDeclaration: (call: Node) => Node | undefined,
  loweredValues?: LoweredValueContract,
): ReturnValueFlow {
  const nodes = collectProgramNodes(source);
  const locals = createReturnLocalFlow(source, nodes);
  const storage = createReturnStorageFlow(source, nodes);
  const runtime = createTypeScriptRuntimeReturnContract(source, nodes);
  const projections = createReturnProjectionFlow(
    source,
    nodes,
    directCallDeclaration,
  );
  const calls = createReturnCallFlow(source);
  const rootScope: ReturnProofScope = Object.freeze({
    inputs: new Map(),
    root: true,
  });
  const results = new Map<ReturnProofScope, Map<Node, boolean>>();
  const prove = (
    value: ReturnProofValue,
    pendingDeclarations: Set<Node>,
    pendingBindings: Set<Node>,
  ): boolean => expressionIsDefinitelyNonThenableWithin(
    source,
    value,
    locals,
    storage,
    runtime,
    loweredValues,
    projections,
    calls,
    results,
    pendingDeclarations,
    pendingBindings,
  );
  return Object.freeze({
    isDefinitelyNonThenable(expression: Node): boolean {
      return prove(
        { expression, scope: rootScope },
        new Set(),
        new Set(),
      );
    },
    callResultIsDefinitelyNonThenable(
      call: Node,
      declarations: readonly Node[],
    ): boolean {
      const pendingBindings = new Set<Node>();
      return calls.isDefinitelyNonThenable(
        { expression: call, scope: rootScope },
        declarations,
        (value, pendingDeclarations) =>
          prove(value, pendingDeclarations, pendingBindings),
        new Set(),
      );
    },
  });
}

export function expressionIsDefinitelyNonThenable(
  source: TargetSourceProgram,
  expression: Node,
): boolean {
  const root = transparentExpression(source, expression);
  if (root === undefined) {
    return false;
  }
  if (source.ast.is.IsAwaitExpression(root)) {
    return true;
  }
  const semantics = source.semantics.forNode(root);
  const type = semantics.getTypeAtLocation(root);
  if (
    type === undefined ||
    typeExposesCallableThen(semantics, type)
  ) {
    return false;
  }
  if (source.ast.is.IsArrayLiteralExpression(root)) {
    return true;
  }
  if (source.ast.is.IsObjectLiteralExpression(root)) {
    return objectLiteralIsDefinitelyNonThenable(source, root);
  }
  if (source.ast.is.IsNewExpression(root)) {
    return projectConstructionIsDefinitelyNonThenable(source, root, type);
  }
  return semantics.isNever(type) ||
      semantics.isVoidLike(type) ||
      semantics.isNullish(type) ||
      semantics.isStringLike(type) ||
      semantics.isNumberLike(type) ||
      semantics.isBooleanLike(type) ||
      semantics.isBigIntLike(type);
}

function expressionIsDefinitelyNonThenableWithin(
  source: TargetSourceProgram,
  value: ReturnProofValue,
  locals: ReturnLocalFlow,
  storage: ReturnStorageFlow,
  runtime: TypeScriptRuntimeReturnContract,
  loweredValues: LoweredValueContract | undefined,
  projections: ReturnProjectionFlow,
  calls: ReturnCallFlow,
  results: Map<ReturnProofScope, Map<Node, boolean>>,
  pendingDeclarations: Set<Node>,
  pendingBindings: Set<Node>,
): boolean {
  const expression = value.expression;
  if (expressionIsDefinitelyNonThenable(source, expression)) {
    return true;
  }
  const root = transparentExpression(source, expression);
  if (root === undefined) {
    return false;
  }
  if (source.ast.is.IsConditionalExpression(root)) {
    const conditional = source.ast.as.AsConditionalExpression(root);
    return conditional?.WhenTrue !== undefined &&
      conditional.WhenFalse !== undefined &&
      expressionIsDefinitelyNonThenableWithin(
        source,
        { expression: conditional.WhenTrue, scope: value.scope },
        locals,
        storage,
        runtime,
        loweredValues,
        projections,
        calls,
        results,
        pendingDeclarations,
        pendingBindings,
      ) &&
      expressionIsDefinitelyNonThenableWithin(
        source,
        { expression: conditional.WhenFalse, scope: value.scope },
        locals,
        storage,
        runtime,
        loweredValues,
        projections,
        calls,
        results,
        pendingDeclarations,
        pendingBindings,
      );
  }
  if (runtime.callResultIsDefinitelyNonThenable(root)) {
    return true;
  }
  if (loweredValues?.isDefinitelyNonThenable(root, (input) =>
    expressionIsDefinitelyNonThenableWithin(
      source,
      { expression: input, scope: value.scope },
      locals,
      storage,
      runtime,
      loweredValues,
      projections,
      calls,
      results,
      pendingDeclarations,
      pendingBindings,
    )
  ) === true) {
    return true;
  }
  const callDeclaration = source.ast.is.IsCallExpression(root)
    ? calls.directDeclaration(root)
    : undefined;
  if (
    callDeclaration !== undefined &&
    calls.isDefinitelyNonThenable(
      { expression: root, scope: value.scope },
      [callDeclaration],
      (input, nextPendingDeclarations) =>
        expressionIsDefinitelyNonThenableWithin(
          source,
          input,
          locals,
          storage,
          runtime,
          loweredValues,
          projections,
          calls,
          results,
          nextPendingDeclarations,
          pendingBindings,
        ),
      pendingDeclarations,
    )
  ) {
    return true;
  }
  if (value.scope.root && projections.isDefinitelyNonThenable(root, (input) =>
    expressionIsDefinitelyNonThenableWithin(
      source,
      { expression: input, scope: value.scope },
      locals,
      storage,
      runtime,
      loweredValues,
      projections,
      calls,
      results,
      pendingDeclarations,
      pendingBindings,
    )
  )) {
    return true;
  }
  const referencedDeclaration = source.ast.is.IsIdentifier(root)
    ? source.navigation.sourceReferenceFor(root)?.declaration
    : undefined;
  const scopedInput = referencedDeclaration === undefined
    ? undefined
    : value.scope.inputs.get(referencedDeclaration);
  if (scopedInput !== undefined) {
    return expressionIsDefinitelyNonThenableWithin(
      source,
      scopedInput,
      locals,
      storage,
      runtime,
      loweredValues,
      projections,
      calls,
      results,
      pendingDeclarations,
      pendingBindings,
    );
  }
  const localBinding = source.ast.is.IsIdentifier(root)
    ? locals.bindingFor(root)
    : undefined;
  const storageBinding = storage.bindingFor(root);
  const binding = localBinding ?? storageBinding;
  if (binding === undefined) {
    return false;
  }
  const scopeResults = results.get(value.scope);
  const existing = scopeResults?.get(binding.declaration);
  if (existing !== undefined) {
    return existing;
  }
  if (pendingBindings.has(binding.declaration)) {
    return storageBinding !== undefined;
  }
  pendingBindings.add(binding.declaration);
  const result = binding.inputs.every((input) =>
    expressionIsDefinitelyNonThenableWithin(
      source,
      { expression: input, scope: value.scope },
      locals,
      storage,
      runtime,
      loweredValues,
      projections,
      calls,
      results,
      pendingDeclarations,
      pendingBindings,
    )
  );
  pendingBindings.delete(binding.declaration);
  if (scopeResults === undefined) {
    results.set(value.scope, new Map([[binding.declaration, result]]));
  } else {
    scopeResults.set(binding.declaration, result);
  }
  return result;
}
