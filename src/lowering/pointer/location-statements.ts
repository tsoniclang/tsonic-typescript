import type { Node } from "@tsonic/tsts";
import type { TargetSourceProgram } from "@tsonic/target-api";
import {
  AsBlock,
  AsCaseOrDefaultClause,
  AsExpressionStatement,
  AsModuleBlock,
  AsSourceFile,
  AsVariableDeclarationList,
  AsVariableStatement,
  IsBlock,
  IsCaseClause,
  IsDefaultClause,
  IsExpressionStatement,
  IsImportDeclaration,
  IsModuleBlock,
  IsSourceFile,
  IsStringLiteral,
  IsVariableDeclaration,
  IsVariableDeclarationList,
  IsVariableStatement,
  NewBlock,
  NewReturnStatement,
  NodeFactory_NewNodeList,
  NodeFactory_UpdateBlock,
  NodeFactory_UpdateCaseOrDefaultClause,
  NodeFactory_UpdateModuleBlock,
  NodeFactory_UpdateSourceFile,
  NodeFactory_UpdateVariableDeclarationList,
  NodeFactory_UpdateVariableStatement,
} from "@tsonic/tsts/target-ast";
import type { NodeFactory } from "@tsonic/tsts/target-ast";

import type { FinalNodeLookup } from "../final-nodes.js";

import { createBoundLocationStatement } from "./bound-location-ast.js";
import { PointerLoweringError } from "./diagnostic.js";
import type {
  LocalLocationBinding,
  LocationBinding,
  PointerLoweringPlan,
} from "./plan.js";

export function rewriteLocationStatementOwner(
  source: TargetSourceProgram,
  factory: NodeFactory,
  original: Node,
  updated: Node,
  plan: PointerLoweringPlan,
  finalNodes: FinalNodeLookup,
  consume: (binding: LocationBinding) => void,
): Node {
  const statements: Node[] = [];
  for (const originalStatement of source.ast.statements(original)) {
    if (originalStatement === undefined) {
      throw new PointerLoweringError(
        "statement-list owner contains an absent source statement",
      );
    }
    const updatedStatement = finalNodes.forOriginal(originalStatement);
    const bindings = plan.localBindingsByStatement.get(originalStatement);
    if (bindings === undefined) {
      if (updatedStatement !== undefined) {
        statements.push(updatedStatement);
      }
      continue;
    }
    if (updatedStatement === undefined) {
      throw new PointerLoweringError(
        "addressed variable statement was removed before location insertion",
      );
    }
    statements.push(...expandVariableStatement(
      factory,
      originalStatement,
      updatedStatement,
      bindings,
      plan.runtimeAlias,
      finalNodes,
      consume,
    ));
  }

  const prologueBindings = plan.prologueBindingsByBody.get(original) ?? [];
  if (prologueBindings.length !== 0) {
    const insertionIndex = statementPrologueEnd(statements, IsSourceFile(updated));
    const prologue = prologueBindings.map((binding) => {
      consume(binding);
      return createBoundLocationStatement(factory, binding, plan.runtimeAlias);
    });
    statements.splice(insertionIndex, 0, ...prologue);
  }
  return updateStatementOwner(factory, updated, statements);
}

export function wrapExpressionLocationBody(
  factory: NodeFactory,
  expression: Node,
  bindings: readonly LocationBinding[],
  runtimeAlias: string,
  consume: (binding: LocationBinding) => void,
): Node {
  const prologue = bindings.map((binding) => {
    consume(binding);
    return createBoundLocationStatement(factory, binding, runtimeAlias);
  });
  return requiredNode(
    NewBlock(
      factory,
      NodeFactory_NewNodeList(factory, [
        ...prologue,
        requiredNode(
          NewReturnStatement(factory, expression),
          "expression-body return statement",
        ),
      ]),
      true,
    ),
    "expression body with location companions",
  );
}

function expandVariableStatement(
  factory: NodeFactory,
  original: Node,
  updated: Node,
  bindings: readonly LocalLocationBinding[],
  runtimeAlias: string,
  finalNodes: FinalNodeLookup,
  consume: (binding: LocationBinding) => void,
): readonly Node[] {
  const originalStatement = IsVariableStatement(original)
    ? AsVariableStatement(original)
    : undefined;
  const updatedStatement = IsVariableStatement(updated)
    ? AsVariableStatement(updated)
    : undefined;
  const originalList = originalStatement?.DeclarationList === undefined
    ? undefined
    : AsVariableDeclarationList(originalStatement.DeclarationList);
  const updatedList = updatedStatement?.DeclarationList === undefined
    ? undefined
    : AsVariableDeclarationList(updatedStatement.DeclarationList);
  if (
    originalStatement === undefined ||
    updatedStatement === undefined ||
    originalList === undefined ||
    updatedList === undefined
  ) {
    throw new PointerLoweringError(
      "addressed binding lost its variable statement",
    );
  }
  const bindingByDeclaration = new Map(
    bindings.map((binding) => [binding.declaration, binding] as const),
  );
  const statements: Node[] = [];
  for (const originalDeclaration of originalList.Declarations?.Nodes ?? []) {
    if (originalDeclaration === undefined) {
      throw new PointerLoweringError(
        "addressed variable statement contains an absent declaration",
      );
    }
    const updatedDeclaration = finalNodes.forOriginal(originalDeclaration);
    if (
      updatedDeclaration === undefined ||
      !IsVariableDeclaration(updatedDeclaration)
    ) {
      throw new PointerLoweringError(
        "addressed variable statement lost an exact declaration",
      );
    }
    const declarationList = requiredNode(
      NodeFactory_UpdateVariableDeclarationList(
        factory,
        updatedList,
        NodeFactory_NewNodeList(factory, [updatedDeclaration]),
        updatedList.Flags,
      ),
      "single source declaration list",
    );
    statements.push(requiredNode(
      NodeFactory_UpdateVariableStatement(
        factory,
        updatedStatement,
        updatedStatement.modifiers,
        declarationList,
      ),
      "single source variable statement",
    ));
    const binding = bindingByDeclaration.get(originalDeclaration);
    if (binding !== undefined) {
      statements.push(
        createBoundLocationStatement(factory, binding, runtimeAlias),
      );
      consume(binding);
    }
  }
  return statements;
}

function updateStatementOwner(
  factory: NodeFactory,
  updated: Node,
  statements: readonly Node[],
): Node {
  const list = NodeFactory_NewNodeList(factory, [...statements]);
  if (IsSourceFile(updated)) {
    const sourceFile = AsSourceFile(updated);
    return requiredNode(
      NodeFactory_UpdateSourceFile(
        factory,
        sourceFile,
        list,
        sourceFile?.EndOfFileToken,
      ),
      "source file with location statements",
    );
  }
  if (IsBlock(updated)) {
    const block = AsBlock(updated);
    return requiredNode(
      NodeFactory_UpdateBlock(factory, block, list, block?.MultiLine ?? true),
      "block with location statements",
    );
  }
  if (IsModuleBlock(updated)) {
    return requiredNode(
      NodeFactory_UpdateModuleBlock(factory, AsModuleBlock(updated), list),
      "module block with location statements",
    );
  }
  if (IsCaseClause(updated) || IsDefaultClause(updated)) {
    const clause = AsCaseOrDefaultClause(updated);
    return requiredNode(
      NodeFactory_UpdateCaseOrDefaultClause(
        factory,
        clause,
        clause?.Expression,
        list,
      ),
      "case clause with location statements",
    );
  }
  throw new PointerLoweringError(
    "location statement owner has an unsupported target AST kind",
  );
}

function statementPrologueEnd(
  statements: readonly Node[],
  sourceFile: boolean,
): number {
  let index = 0;
  while (index < statements.length) {
    const statement = statements[index];
    if (statement === undefined) {
      break;
    }
    if (sourceFile && IsImportDeclaration(statement)) {
      index += 1;
      continue;
    }
    if (!IsExpressionStatement(statement)) {
      break;
    }
    const expression = AsExpressionStatement(statement)?.Expression;
    if (expression === undefined || !IsStringLiteral(expression)) {
      break;
    }
    index += 1;
  }
  return index;
}

function requiredNode(node: Node | undefined, subject: string): Node {
  if (node === undefined) {
    throw new PointerLoweringError(`${subject} was not created`);
  }
  return node;
}
