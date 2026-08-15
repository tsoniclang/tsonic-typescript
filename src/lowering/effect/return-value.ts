import type { Node } from "@tsonic/tsts";
import type { TargetSourceProgram } from "@tsonic/target-api";
import { KindImportDeclaration } from "@tsonic/tsts/target-ast";

import type { LoweredValueContract } from "../value-contract.js";
import type { TargetProgramIndex } from "../program-index.js";
import type { StorageOwnerTransportContract } from "../storage-owner-transport.js";
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
  transparentExpression,
} from "./syntax.js";
import {
  typeExposesCallableThen,
  typeHasDefinitelyNonThenableContract,
} from "./synchronous.js";

export interface ReturnValueFlow {
  isDefinitelyNonThenable(expression: Node): boolean;
  callResultIsDefinitelyNonThenable(
    call: Node,
    declarations: readonly Node[],
    settledDeclarations?: ReadonlySet<Node>,
  ): boolean;
}

export function createReturnValueFlow(
  source: TargetSourceProgram,
  program: TargetProgramIndex,
  directCallDeclaration: (call: Node) => Node | undefined,
  loweredValues?: LoweredValueContract,
  settledCallDeclarations: (call: Node) => readonly Node[] = () => [],
  transports?: StorageOwnerTransportContract,
): ReturnValueFlow {
  const locals = createReturnLocalFlow(source, program);
  const storage = createReturnStorageFlow(source, program, transports);
  const runtime = createTypeScriptRuntimeReturnContract(
    source,
    program.nodesOfKind(KindImportDeclaration),
  );
  const projections = createReturnProjectionFlow(
    source,
    program,
    directCallDeclaration,
  );
  const calls = createReturnCallFlow(
    source,
    program,
    settledCallDeclarations,
  );
  const rootScope: ReturnProofScope = Object.freeze({
    inputs: new Map(),
    root: true,
  });
  const resultsBySettlement = new Map<
    ReadonlySet<Node> | undefined,
    Map<ReturnProofScope, Map<Node, boolean>>
  >();
  const prove = (
    value: ReturnProofValue,
    pendingDeclarations: Set<Node>,
    pendingBindings: Set<Node>,
    settledDeclarations?: ReadonlySet<Node>,
  ): boolean => expressionIsDefinitelyNonThenableWithin(
    source,
    value,
    locals,
    storage,
    runtime,
    loweredValues,
    projections,
    calls,
    resultsFor(resultsBySettlement, settledDeclarations),
    pendingDeclarations,
    pendingBindings,
    settledDeclarations,
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
      settledDeclarations?: ReadonlySet<Node>,
    ): boolean {
      const pendingBindings = new Set<Node>();
      return calls.isDefinitelyNonThenable(
        { expression: call, scope: rootScope },
        declarations,
        (value, pendingDeclarations, selectedDeclarations) =>
          prove(
            value,
            pendingDeclarations,
            pendingBindings,
            selectedDeclarations,
          ),
        new Set(),
        settledDeclarations,
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
  if (
    source.ast.is.IsArrowFunction(root) ||
    source.ast.is.IsFunctionExpression(root)
  ) {
    return true;
  }
  if (source.ast.is.IsObjectLiteralExpression(root)) {
    return objectLiteralIsDefinitelyNonThenable(source, root);
  }
  if (source.ast.is.IsNewExpression(root)) {
    return typeHasDefinitelyNonThenableContract(source, semantics, type) ||
      projectConstructionIsDefinitelyNonThenable(source, root, type);
  }
  return typeHasDefinitelyNonThenableContract(source, semantics, type);
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
  settledDeclarations: ReadonlySet<Node> | undefined,
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
        settledDeclarations,
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
        settledDeclarations,
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
      settledDeclarations,
    )
  ) === true) {
    return true;
  }
  const isCall = source.ast.is.IsCallExpression(root);
  const callDeclaration = isCall
    ? calls.directDeclaration(root)
    : undefined;
  if (
    isCall &&
    calls.isDefinitelyNonThenable(
      { expression: root, scope: value.scope },
      callDeclaration === undefined ? [] : [callDeclaration],
      (input, nextPendingDeclarations, selectedDeclarations) =>
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
          selectedDeclarations,
        ),
      pendingDeclarations,
      settledDeclarations,
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
      settledDeclarations,
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
      settledDeclarations,
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
      settledDeclarations,
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

function resultsFor(
  resultsBySettlement: Map<
    ReadonlySet<Node> | undefined,
    Map<ReturnProofScope, Map<Node, boolean>>
  >,
  settledDeclarations: ReadonlySet<Node> | undefined,
): Map<ReturnProofScope, Map<Node, boolean>> {
  const existing = resultsBySettlement.get(settledDeclarations);
  if (existing !== undefined) {
    return existing;
  }
  const created = new Map<ReturnProofScope, Map<Node, boolean>>();
  resultsBySettlement.set(settledDeclarations, created);
  return created;
}
