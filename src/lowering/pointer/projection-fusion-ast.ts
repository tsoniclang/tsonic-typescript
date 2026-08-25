import type { Node } from "@tsonic/tsts";
import type { TargetSourceProgram } from "@tsonic/target-api/source";
import {
  KindEqualsToken,
  NewBinaryExpression,
  NewCallExpression,
  NewIdentifier,
  NewNonNullExpression,
  NewPropertyAccessExpression,
  NewToken,
  NewVoidExpression,
  NodeFactory_NewNodeList,
} from "@tsonic/tsts/target-ast";
import type { NodeFactory } from "@tsonic/tsts/target-ast";

import type { FinalNodeLookup } from "../final-nodes.js";
import { PointerLoweringError } from "./diagnostic.js";
import { pointerTypeCanBeUndefined } from "./nullability.js";
import type { PointerProjectionFusion } from "./projection-fusion.js";

export function lowerPointerProjectionFusion(
  source: TargetSourceProgram,
  factory: NodeFactory,
  fusion: PointerProjectionFusion,
  finalNodes: FinalNodeLookup,
): Node {
  const projection = fusion.projection;
  const sourceStorage = requiredNode(
    NewPropertyAccessExpression(
      factory,
      requiredNode(
        NewNonNullExpression(
          factory,
          finalized(
            finalNodes,
            projection.pointerExpression,
            "projection source value",
          ),
          0,
        ),
        "non-null projection source",
      ),
      undefined,
      requiredIdentifier(factory, "value"),
      0,
    ),
    "projection source storage",
  );
  if (fusion.kind === "load") {
    return call(
      factory,
      finalized(
        finalNodes,
        projection.fromSourceExpression,
        "projection read converter",
      ),
      [sourceStorage],
    );
  }
  if (
    pointerTypeCanBeUndefined(
      source,
      projection.pointerExpression,
      projection.pointerType,
    )
  ) {
    throw new PointerLoweringError(
      "nullable projected stores must retain canonical evaluation order",
    );
  }
  const assignment = requiredNode(
    NewBinaryExpression(
      factory,
      undefined,
      sourceStorage,
      undefined,
      NewToken(factory, KindEqualsToken),
      call(
        factory,
        finalized(
          finalNodes,
          projection.toSourceExpression,
          "projection write converter",
        ),
        [
          finalized(
            finalNodes,
            fusion.consumer.valueExpression,
            "projection store value",
          ),
        ],
      ),
    ),
    "projection store assignment",
  );
  return requiredNode(
    NewVoidExpression(factory, assignment),
    "projection store result",
  );
}

function call(
  factory: NodeFactory,
  target: Node,
  arguments_: readonly Node[],
): Node {
  return requiredNode(
    NewCallExpression(
      factory,
      target,
      undefined,
      undefined,
      NodeFactory_NewNodeList(factory, [...arguments_]),
      0,
    ),
    "projection fusion call",
  );
}

function finalized(
  finalNodes: FinalNodeLookup,
  original: Node,
  subject: string,
): Node {
  return requiredNode(finalNodes.forOriginal(original), subject);
}

function requiredIdentifier(factory: NodeFactory, name: string): Node {
  return requiredNode(NewIdentifier(factory, name), `identifier ${name}`);
}

function requiredNode(node: Node | undefined, subject: string): Node {
  if (node === undefined) {
    throw new PointerLoweringError(`${subject} was not created`);
  }
  return node;
}
