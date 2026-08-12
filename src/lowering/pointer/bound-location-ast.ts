import type { Node } from "@tsonic/tsts";
import {
  KindEqualsGreaterThanToken,
  KindEqualsToken,
  NewArrowFunction,
  NewBinaryExpression,
  NewIdentifier,
  NewObjectLiteralExpression,
  NewParameterDeclaration,
  NewToken,
  NewVariableDeclaration,
  NewVariableDeclarationList,
  NewVariableStatement,
  NodeFactory_NewNodeList,
  NodeFlagsConst,
} from "@tsonic/tsts/target-ast";
import type { NodeFactory } from "@tsonic/tsts/target-ast";

import type { GeneratedBindingName } from "../generated-names.js";
import { PointerLoweringError } from "./diagnostic.js";
import type { LocationBinding } from "./plan.js";
import { runtimeCall } from "./runtime-ast.js";

export function createBoundLocationDeclaration(
  factory: NodeFactory,
  binding: LocationBinding,
  runtimeAlias: GeneratedBindingName,
): Node {
  return requiredNode(
    NewVariableDeclaration(
      factory,
      requiredGeneratedIdentifier(factory, binding.locationName),
      undefined,
      undefined,
      runtimeCall(
        factory,
        runtimeAlias,
        "boundLocation",
        [],
        [
          requiredNode(
            NewObjectLiteralExpression(
              factory,
              NodeFactory_NewNodeList(factory, []),
              false,
            ),
            "location identity object",
          ),
          createReadClosure(factory, binding),
          createWriteClosure(factory, binding),
        ],
      ),
    ),
    "bound location declaration",
  );
}

export function createBoundLocationStatement(
  factory: NodeFactory,
  binding: LocationBinding,
  runtimeAlias: GeneratedBindingName,
): Node {
  const declarations = requiredNode(
    NewVariableDeclarationList(
      factory,
      NodeFactory_NewNodeList(factory, [
        createBoundLocationDeclaration(factory, binding, runtimeAlias),
      ]),
      NodeFlagsConst,
    ),
    "bound location declaration list",
  );
  return requiredNode(
    NewVariableStatement(factory, undefined, declarations),
    "bound location statement",
  );
}

function createReadClosure(
  factory: NodeFactory,
  binding: LocationBinding,
): Node {
  return requiredNode(
    NewArrowFunction(
      factory,
      undefined,
      undefined,
      NodeFactory_NewNodeList(factory, []),
      undefined,
      undefined,
      NewToken(factory, KindEqualsGreaterThanToken),
      requiredIdentifier(factory, binding.sourceName),
    ),
    "bound location read closure",
  );
}

function createWriteClosure(
  factory: NodeFactory,
  binding: LocationBinding,
): Node {
  const writeParameter = requiredNode(
    NewParameterDeclaration(
      factory,
      undefined,
      undefined,
      requiredGeneratedIdentifier(factory, binding.writeName),
      undefined,
      undefined,
      undefined,
    ),
    "bound location write parameter",
  );
  const assignment = requiredNode(
    NewBinaryExpression(
      factory,
      undefined,
      requiredIdentifier(factory, binding.sourceName),
      undefined,
      NewToken(factory, KindEqualsToken),
      requiredGeneratedIdentifier(factory, binding.writeName),
    ),
    "bound location write assignment",
  );
  return requiredNode(
    NewArrowFunction(
      factory,
      undefined,
      undefined,
      NodeFactory_NewNodeList(factory, [writeParameter]),
      undefined,
      undefined,
      NewToken(factory, KindEqualsGreaterThanToken),
      assignment,
    ),
    "bound location write closure",
  );
}

function requiredIdentifier(factory: NodeFactory, name: string): Node {
  return requiredNode(NewIdentifier(factory, name), `identifier ${name}`);
}

function requiredGeneratedIdentifier(
  factory: NodeFactory,
  name: GeneratedBindingName,
): Node {
  return requiredIdentifier(factory, name.text);
}

function requiredNode(node: Node | undefined, subject: string): Node {
  if (node === undefined) {
    throw new PointerLoweringError(`${subject} was not created`);
  }
  return node;
}
