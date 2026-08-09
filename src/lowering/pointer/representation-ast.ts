import type { Node, PointerOperationFact } from "@tsonic/tsts";
import {
  AsCallExpression,
  AsTypeReferenceNode,
  IsCallExpression,
  IsTypeReferenceNode,
  KindEqualsToken,
  NewBinaryExpression,
  NewIdentifier,
  NewObjectLiteralExpression,
  NewPropertyAssignment,
  NewPropertyAccessExpression,
  NewPropertySignatureDeclaration,
  NewToken,
  NewTypeLiteralNode,
  NewVoidExpression,
  NodeFactory_NewNodeList,
} from "@tsonic/tsts/target-ast";
import type { NodeFactory } from "@tsonic/tsts/target-ast";

import { PointerLoweringError } from "./diagnostic.js";
import type { PointerFlowRepresentation } from "./flow-plan.js";

export function lowerOptimizedPointerType(
  factory: NodeFactory,
  updated: Node,
  representation: PointerFlowRepresentation,
): Node | undefined {
  if (representation === "location") {
    return undefined;
  }
  const reference = IsTypeReferenceNode(updated)
    ? AsTypeReferenceNode(updated)
    : undefined;
  const pointee = reference?.TypeArguments?.Nodes[0];
  if (
    reference === undefined ||
    reference.TypeArguments?.Nodes.length !== 1 ||
    pointee === undefined
  ) {
    throw new PointerLoweringError(
      "optimized Pointer<T> must retain exactly one pointee type",
    );
  }
  if (
    representation === "direct-snapshot" ||
    representation === "direct-object"
  ) {
    return pointee;
  }
  const value = requiredNode(
    NewPropertySignatureDeclaration(
      factory,
      undefined,
      NewIdentifier(factory, "value"),
      undefined,
      pointee,
      undefined,
    ),
    "mutable pointer-cell value type",
  );
  return requiredNode(
    NewTypeLiteralNode(
      factory,
      NodeFactory_NewNodeList(factory, [value]),
    ),
    "mutable pointer-cell type",
  );
}

export function lowerOptimizedPointerOperation(
  factory: NodeFactory,
  operation: PointerOperationFact,
  updated: Node,
  representation: PointerFlowRepresentation,
): Node | undefined {
  if (representation === "location") {
    return undefined;
  }
  const call = IsCallExpression(updated) ? AsCallExpression(updated) : undefined;
  const arguments_ = call?.Arguments?.Nodes ?? [];
  if (call === undefined) {
    throw new PointerLoweringError(
      `${operation.operation} optimized flow lost its exact call arguments`,
    );
  }
  const values = requireNodes(arguments_, operation.operation);
  if (
    representation === "direct-snapshot" ||
    representation === "direct-object"
  ) {
    if (
      operation.operation !== "allocate" &&
      operation.operation !== "address-of" &&
      operation.operation !== "load"
    ) {
      throw new PointerLoweringError(
        `${representation} cannot lower ${operation.operation}`,
      );
    }
    requireArity(operation.operation, values, 1);
    return values[0];
  }
  switch (operation.operation) {
    case "allocate":
      requireArity(operation.operation, values, 1);
      return mutableCell(factory, requiredValue(values, 0));
    case "load":
      requireArity(operation.operation, values, 1);
      return cellValue(factory, requiredValue(values, 0));
    case "store": {
      requireArity(operation.operation, values, 2);
      const assignment = requiredNode(
        NewBinaryExpression(
          factory,
          undefined,
          cellValue(factory, requiredValue(values, 0)),
          undefined,
          NewToken(factory, KindEqualsToken),
          requiredValue(values, 1),
        ),
        "mutable pointer-cell assignment",
      );
      return requiredNode(
        NewVoidExpression(factory, assignment),
        "mutable pointer-cell store",
      );
    }
    default:
      throw new PointerLoweringError(
        `mutable-cell cannot lower ${operation.operation}`,
      );
  }
}

function mutableCell(factory: NodeFactory, initial: Node): Node {
  const value = requiredNode(
    NewPropertyAssignment(
      factory,
      undefined,
      NewIdentifier(factory, "value"),
      undefined,
      undefined,
      initial,
    ),
    "mutable pointer-cell value",
  );
  return requiredNode(
    NewObjectLiteralExpression(
      factory,
      NodeFactory_NewNodeList(factory, [value]),
      false,
    ),
    "mutable pointer cell",
  );
}

function cellValue(factory: NodeFactory, pointer: Node): Node {
  return requiredNode(
    NewPropertyAccessExpression(
      factory,
      pointer,
      undefined,
      NewIdentifier(factory, "value"),
      0,
    ),
    "mutable pointer-cell value access",
  );
}

function requireArity(
  operation: PointerOperationFact["operation"],
  values: readonly Node[],
  expected: number,
): void {
  if (values.length !== expected) {
    throw new PointerLoweringError(
      `${operation} requires ${expected} exact arguments, got ${values.length}`,
    );
  }
}

function requiredValue(values: readonly Node[], index: number): Node {
  const value = values[index];
  if (value === undefined) {
    throw new PointerLoweringError(`optimized pointer operation lost argument ${index}`);
  }
  return value;
}

function requireNodes(
  values: readonly (Node | undefined)[],
  operation: PointerOperationFact["operation"],
): readonly Node[] {
  return values.map((value, index) => {
    if (value === undefined) {
      throw new PointerLoweringError(
        `${operation} optimized flow lost argument ${index}`,
      );
    }
    return value;
  });
}

function requiredNode(node: Node | undefined, subject: string): Node {
  if (node === undefined) {
    throw new PointerLoweringError(`${subject} was not created`);
  }
  return node;
}
