import type { Node } from "@tsonic/tsts";
import {
  AsBlock,
  AsExpressionStatement,
  IsBlock,
  IsExpressionStatement,
  IsStringLiteral,
  NewBlock,
  NewIdentifier,
  NewReturnStatement,
  NewVariableDeclaration,
  NewVariableDeclarationList,
  NewVariableStatement,
  NodeFactory_NewNodeList,
  NodeFactory_UpdateBlock,
  NodeFlagsConst,
} from "@tsonic/tsts/target-ast";
import type { NodeFactory } from "@tsonic/tsts/target-ast";

import { PointerLoweringError } from "./diagnostic.js";
import type { ParameterLocationBinding } from "./plan.js";
import { runtimeCall } from "./runtime-ast.js";

export function prependParameterLocations(
  factory: NodeFactory,
  updated: Node,
  bindings: readonly ParameterLocationBinding[],
  runtimeAlias: string,
): Node {
  const body = IsBlock(updated) ? AsBlock(updated) : undefined;
  const initializers = bindings.map((binding) => requiredNode(
    NewVariableStatement(
      factory,
      undefined,
      requiredNode(
        NewVariableDeclarationList(
          factory,
          NodeFactory_NewNodeList(factory, [requiredNode(
            NewVariableDeclaration(
              factory,
              NewIdentifier(factory, binding.locationName),
              undefined,
              undefined,
              runtimeCall(
                factory,
                runtimeAlias,
                "location",
                [],
                [requiredNode(
                  NewIdentifier(factory, binding.sourceName),
                  "addressed parameter reference",
                )],
              ),
            ),
            "addressed parameter location declaration",
          )]),
          NodeFlagsConst,
        ),
        "addressed parameter declaration list",
      ),
    ),
    "addressed parameter initialization statement",
  ));
  if (body === undefined) {
    return requiredNode(
      NewBlock(
        factory,
        NodeFactory_NewNodeList(factory, [
          ...initializers,
          requiredNode(
            NewReturnStatement(factory, updated),
            "expression-bodied parameter return",
          ),
        ]),
        true,
      ),
      "expression-bodied parameter block",
    );
  }
  const statements = requiredNodes(
    body.Statements?.Nodes ?? [],
    "addressed parameter body statements",
  );
  const prologueEnd = prologueDirectiveCount(statements);
  return requiredNode(
    NodeFactory_UpdateBlock(
      factory,
      body,
      NodeFactory_NewNodeList(factory, [
        ...statements.slice(0, prologueEnd),
        ...initializers,
        ...statements.slice(prologueEnd),
      ]),
      body.MultiLine,
    ),
    "body with addressed parameter locations",
  );
}

function prologueDirectiveCount(statements: readonly Node[]): number {
  let count = 0;
  for (const statement of statements) {
    if (!IsExpressionStatement(statement)) {
      break;
    }
    const expression = AsExpressionStatement(statement)?.Expression;
    if (expression === undefined || !IsStringLiteral(expression)) {
      break;
    }
    count += 1;
  }
  return count;
}

function requiredNode(node: Node | undefined, subject: string): Node {
  if (node === undefined) {
    throw new PointerLoweringError(`${subject} was not created`);
  }
  return node;
}

function requiredNodes(
  nodes: readonly (Node | undefined)[],
  subject: string,
): readonly Node[] {
  return nodes.map((node, index) => requiredNode(node, `${subject}[${index}]`));
}
