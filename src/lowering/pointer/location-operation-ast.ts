import type { Node, PointerOperationFact } from "@tsonic/tsts";
import type { TargetSourceProgram } from "@tsonic/target-api/source";
import {
  AsCallExpression,
  AsTypeReferenceNode,
  IsCallExpression,
  IsTypeReferenceNode,
  KindEqualsToken,
  NewBinaryExpression,
  NewToken,
  NewVoidExpression,
} from "@tsonic/tsts/target-ast";
import type { NodeFactory } from "@tsonic/tsts/target-ast";

import type { FinalNodeLookup } from "../final-nodes.js";
import type { GeneratedBindingName } from "../generated-names.js";

import { lowerAddressOf } from "./address.js";
import { PointerLoweringError } from "./diagnostic.js";
import type { PointerLoweringPlan } from "./plan.js";
import {
  locationValue,
  runtimeCall,
  runtimeType,
} from "./runtime-ast.js";

export function lowerLocationPointerType(
  factory: NodeFactory,
  updated: Node,
  runtimeAlias: GeneratedBindingName,
): Node {
  const typeReference = IsTypeReferenceNode(updated)
    ? AsTypeReferenceNode(updated)
    : undefined;
  if (
    typeReference === undefined ||
    typeReference.TypeArguments === undefined ||
    typeReference.TypeArguments.Nodes.length !== 1
  ) {
    throw new PointerLoweringError(
      "Pointer<T> fact must own exactly one type argument",
    );
  }
  return runtimeType(
    factory,
    runtimeAlias,
    "Location",
    requireNodes(typeReference.TypeArguments.Nodes, "Pointer<T> type arguments"),
  );
}

export function lowerLocationPointerOperation(
  source: TargetSourceProgram,
  factory: NodeFactory,
  operation: PointerOperationFact,
  updated: Node,
  plan: PointerLoweringPlan,
  finalNodes: FinalNodeLookup,
): Node {
  const call = IsCallExpression(updated) ? AsCallExpression(updated) : undefined;
  if (call === undefined) {
    throw new PointerLoweringError(
      `${operation.operation} fact no longer owns a call expression`,
    );
  }
  const arguments_ = requireNodes(
    call.Arguments?.Nodes ?? [],
    `${operation.operation} arguments`,
  );
  switch (operation.operation) {
    case "allocate":
      requireArity(operation.operation, arguments_, 1);
      return runtimeCall(
        factory,
        plan.runtimeAlias,
        "location",
        requireNodes(
          call.TypeArguments?.Nodes ?? [],
          `${operation.operation} type arguments`,
        ),
        arguments_,
      );
    case "load":
      requireArity(operation.operation, arguments_, 1);
      return locationValue(
        factory,
        requiredElement(arguments_, 0),
        explicitLocationType(factory, operation, call, plan.runtimeAlias),
      );
    case "store": {
      requireArity(operation.operation, arguments_, 2);
      const assignment = NewBinaryExpression(
        factory,
        undefined,
        locationValue(
          factory,
          requiredElement(arguments_, 0),
          explicitLocationType(factory, operation, call, plan.runtimeAlias),
        ),
        undefined,
        NewToken(factory, KindEqualsToken),
        requiredElement(arguments_, 1),
      );
      return requiredNode(
        NewVoidExpression(factory, assignment),
        "pointer store expression",
      );
    }
    case "equal-pointer":
      requireArity(operation.operation, arguments_, 2);
      return runtimeCall(factory, plan.runtimeAlias, "sameLocation", [], arguments_);
    case "hash-pointer":
      requireArity(operation.operation, arguments_, 1);
      return runtimeCall(factory, plan.runtimeAlias, "hashLocation", [], arguments_);
    case "bind-pointer":
      requireArity(operation.operation, arguments_, 3);
      return runtimeCall(
        factory,
        plan.runtimeAlias,
        "boundLocation",
        requireNodes(
          call.TypeArguments?.Nodes ?? [],
          `${operation.operation} type arguments`,
        ),
        arguments_,
      );
    case "project-pointer":
      requireArity(operation.operation, arguments_, 3);
      return runtimeCall(
        factory,
        plan.runtimeAlias,
        "projectLocation",
        requireNodes(
          call.TypeArguments?.Nodes ?? [],
          `${operation.operation} type arguments`,
        ),
        projectionArguments(arguments_, operation, plan, finalNodes),
      );
    case "address-of":
      requireArity(operation.operation, arguments_, 1);
      return lowerAddressOf(
        source,
        factory,
        operation,
        requiredElement(arguments_, 0),
        plan,
        finalNodes,
      );
  }
}

function projectionArguments(
  arguments_: readonly Node[],
  operation: Extract<PointerOperationFact, { readonly operation: "project-pointer" }>,
  plan: PointerLoweringPlan,
  finalNodes: FinalNodeLookup,
): readonly Node[] {
  const selected = plan.projectionCallables.targetsFor(operation.call);
  if (selected === undefined) {
    return arguments_;
  }
  return Object.freeze([
    requiredElement(arguments_, 0),
    selected.fromSource === undefined
      ? requiredElement(arguments_, 1)
      : requiredFinalNode(finalNodes, selected.fromSource, "from-source converter"),
    selected.toSource === undefined
      ? requiredElement(arguments_, 2)
      : requiredFinalNode(finalNodes, selected.toSource, "to-source converter"),
  ]);
}

function requiredFinalNode(
  finalNodes: FinalNodeLookup,
  original: Node,
  subject: string,
): Node {
  const selected = finalNodes.forOriginal(original);
  if (selected === undefined) {
    throw new PointerLoweringError(
      `pointer projection lost its exact ${subject}`,
    );
  }
  return selected;
}

function explicitLocationType(
  factory: NodeFactory,
  operation: PointerOperationFact,
  call: NonNullable<ReturnType<typeof AsCallExpression>>,
  runtimeAlias: GeneratedBindingName,
): Node | undefined {
  if (operation.explicitPointeeTypeNode === undefined) {
    return undefined;
  }
  const typeArguments = requireNodes(
    call.TypeArguments?.Nodes ?? [],
    `${operation.operation} type arguments`,
  );
  if (typeArguments.length !== 1) {
    throw new PointerLoweringError(
      `${operation.operation} has explicit pointee evidence but ${typeArguments.length} transformed type arguments`,
    );
  }
  return runtimeType(factory, runtimeAlias, "Location", typeArguments);
}

function requiredElement(values: readonly Node[], index: number): Node {
  const value = values[index];
  if (value === undefined) {
    throw new PointerLoweringError(`pointer operation lost argument ${index}`);
  }
  return value;
}

function requireNodes(
  values: readonly (Node | undefined)[],
  subject: string,
): readonly Node[] {
  const result: Node[] = [];
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index];
    if (value === undefined) {
      throw new PointerLoweringError(
        `${subject} contains an absent node at index ${index}`,
      );
    }
    result.push(value);
  }
  return result;
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

function requiredNode(node: Node | undefined, subject: string): Node {
  if (node === undefined) {
    throw new PointerLoweringError(`${subject} was not created`);
  }
  return node;
}
