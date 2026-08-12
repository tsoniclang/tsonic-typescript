import { pointerOperationFactKey } from "@tsonic/tsts";
import type { Node, PointerOperationFact } from "@tsonic/tsts";
import type { TargetSourceProgram } from "@tsonic/target-api";
import { KindCallExpression } from "@tsonic/tsts/target-ast";

import type { TargetProgramIndex } from "../program-index.js";
import { transparentExpression } from "./flow-syntax.js";
import { pointerTypeCanBeUndefined } from "./nullability.js";

type ProjectionOperation = Extract<
  PointerOperationFact,
  { readonly operation: "project-pointer" }
>;

type ProjectionConsumer = Extract<
  PointerOperationFact,
  { readonly operation: "load" | "store" }
>;

export type PointerProjectionFusion =
  | {
      readonly kind: "load";
      readonly consumer: Extract<ProjectionConsumer, { readonly operation: "load" }>;
      readonly projection: ProjectionOperation;
    }
  | {
      readonly kind: "store";
      readonly consumer: Extract<ProjectionConsumer, { readonly operation: "store" }>;
      readonly projection: ProjectionOperation;
    };

export interface PointerProjectionFusionPlan {
  fusionForConsumer(node: Node): PointerProjectionFusion | undefined;
  ownsProjection(node: Node): boolean;
  readonly readCount: number;
  readonly storeCount: number;
}

export function planPointerProjectionFusions(
  source: TargetSourceProgram,
  program: TargetProgramIndex,
  isCanonicalLocation: (node: Node) => boolean,
): PointerProjectionFusionPlan {
  const byConsumer = new Map<Node, PointerProjectionFusion>();
  const projections = new Set<Node>();
  let readCount = 0;
  let storeCount = 0;
  for (const node of program.nodesOfKind(KindCallExpression)) {
    const consumer = source.sourceFacts.getFact(node, pointerOperationFactKey);
    if (
      consumer?.operation !== "load" &&
      consumer?.operation !== "store"
    ) {
      continue;
    }
    const projectionCall = transparentExpression(
      source,
      consumer.pointerExpression,
    );
    const projection = projectionCall === undefined
      ? undefined
      : source.sourceFacts.getFact(projectionCall, pointerOperationFactKey);
    if (
      projection?.operation !== "project-pointer" ||
      projection.call !== projectionCall ||
      !isCanonicalLocation(projection.call) ||
      !isArrowValue(source, projection.fromSourceExpression) ||
      !isArrowValue(source, projection.toSourceExpression) ||
      consumer.operation === "store" && pointerTypeCanBeUndefined(
        source,
        projection.pointerExpression,
        projection.pointerType,
      )
    ) {
      continue;
    }
    if (projections.has(projection.call)) {
      throw new Error("one pointer projection cannot own multiple direct consumers");
    }
    const fusion: PointerProjectionFusion = consumer.operation === "load"
      ? Object.freeze({ kind: "load", consumer, projection })
      : Object.freeze({ kind: "store", consumer, projection });
    byConsumer.set(consumer.call, fusion);
    projections.add(projection.call);
    if (consumer.operation === "load") {
      readCount += 1;
    } else {
      storeCount += 1;
    }
  }
  return Object.freeze({
    fusionForConsumer(node: Node): PointerProjectionFusion | undefined {
      return byConsumer.get(node);
    },
    ownsProjection(node: Node): boolean {
      return projections.has(node);
    },
    readCount,
    storeCount,
  });
}

function isArrowValue(
  source: TargetSourceProgram,
  expression: Node,
): boolean {
  const value = transparentExpression(source, expression);
  return value !== undefined && source.ast.is.IsArrowFunction(value);
}
