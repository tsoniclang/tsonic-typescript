import type { Node } from "@tsonic/tsts";
import {
  AsCallExpression,
  NewCallExpression,
  NewIdentifier,
  NewPropertyAccessExpression,
  NewVoidExpression,
  NodeFactory_NewNodeList,
} from "@tsonic/tsts/target-ast";
import type { NodeFactory } from "@tsonic/tsts/target-ast";

import type {
  InlineRepresentationTransport,
} from "../representation/transport-selection.js";
import type { ClosedPointerFlowPlan } from "./flow-plan.js";
import { PointerLoweringError } from "./diagnostic.js";

export interface RepresentationTransportInlinePlan {
  readonly count: number;
  has(node: Node): boolean;
  inlineFor(node: Node): InlineRepresentationTransport | undefined;
}

export interface RepresentationTransportInlineSession {
  readonly count: number;
  has(node: Node): boolean;
  rewrite(original: Node, updated: Node, factory: NodeFactory): Node;
  finish(): void;
}

export function planRepresentationTransportInlines(
  nodes: readonly Node[],
  flowPlan: ClosedPointerFlowPlan | undefined,
): RepresentationTransportInlinePlan {
  const selected = new Map<Node, InlineRepresentationTransport>();
  for (const node of nodes) {
    const inline = flowPlan?.representationTransportInlineFor(node);
    if (inline !== undefined) {
      selected.set(node, inline);
    }
  }
  return Object.freeze({
    count: selected.size,
    has(node: Node): boolean {
      return selected.has(node);
    },
    inlineFor(node: Node): InlineRepresentationTransport | undefined {
      return selected.get(node);
    },
  });
}

export function createRepresentationTransportInlineSession(
  plan: RepresentationTransportInlinePlan,
): RepresentationTransportInlineSession {
  const consumed = new Set<Node>();
  let finished = false;
  return Object.freeze({
    get count(): number {
      return consumed.size;
    },
    has(node: Node): boolean {
      return plan.has(node);
    },
    rewrite(original: Node, updated: Node, factory: NodeFactory): Node {
      if (finished) {
        throw new PointerLoweringError(
          "inline representation transport session is already sealed",
        );
      }
      const transport = plan.inlineFor(original);
      if (transport === undefined || consumed.has(original)) {
        throw new PointerLoweringError(
          "inline representation transport was not consumed exactly once",
        );
      }
      consumed.add(original);
      return inlineRepresentationTransportCall(factory, updated, transport);
    },
    finish(): void {
      if (finished) {
        throw new PointerLoweringError(
          "inline representation transport session was sealed twice",
        );
      }
      finished = true;
      if (consumed.size !== plan.count) {
        throw new PointerLoweringError(
          `consumed ${consumed.size} inline representation transports, expected ${plan.count}`,
        );
      }
    },
  });
}

function inlineRepresentationTransportCall(
  factory: NodeFactory,
  updated: Node,
  transport: InlineRepresentationTransport,
): Node {
  const call = AsCallExpression(updated);
  const arguments_ = call?.Arguments?.Nodes ?? [];
  if (
    call === undefined ||
    call.QuestionDotToken !== undefined ||
    arguments_.length !== transport.parameterCount ||
    arguments_.some((argument) => argument === undefined)
  ) {
    throw new PointerLoweringError(
      "planned inline representation transport lost its exact call shape",
    );
  }
  const receiver = arguments_[0];
  if (receiver === undefined) {
    throw new PointerLoweringError(
      "planned inline representation transport lost its receiver",
    );
  }
  const target = requiredNode(NewPropertyAccessExpression(
    factory,
    receiver,
    undefined,
    NewIdentifier(factory, transport.memberName),
    0,
  ));
  const methodCall = requiredNode(NewCallExpression(
    factory,
    target,
    undefined,
    undefined,
    NodeFactory_NewNodeList(factory, arguments_.slice(1)),
    0,
  ));
  return requiredNode(NewVoidExpression(factory, methodCall));
}

function requiredNode(node: Node | undefined): Node {
  if (node === undefined) {
    throw new PointerLoweringError(
      "inline representation transport AST construction failed",
    );
  }
  return node;
}
