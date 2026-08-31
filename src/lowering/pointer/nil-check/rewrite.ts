import type { Node, SourceFile } from "@tsonic/tsts";
import {
  AsBlock,
  NewIdentifier,
  NewVariableDeclaration,
  NewVariableDeclarationList,
  NewVariableStatement,
  NodeFactory_NewNodeList,
  NodeFactory_UpdateBlock,
  NodeFlagsConst,
} from "@tsonic/tsts/target-ast";
import type { NodeFactory } from "@tsonic/tsts/target-ast";

import type { FinalNodeLookup } from "../../final-nodes.js";
import type { GeneratedBindingName } from "../../generated-names.js";

import type {
  DominatingNilCheckBindingPlan,
  DominatingNilCheckSourcePlan,
} from "./model.js";

export interface DominatingNilCheckRewriteResult {
  readonly sourceFile: SourceFile;
  readonly bindingCount: number;
  readonly optimizedGuardCount: number;
  readonly eliminatedGuardCount: number;
}

export interface DominatingNilCheckRewriteSession {
  rewrite(original: Node, updated: Node, factory: NodeFactory): Node | undefined;
  finish(sourceFile: SourceFile): DominatingNilCheckRewriteResult;
}

export function createDominatingNilCheckRewriteSession(
  plan: DominatingNilCheckSourcePlan,
  finalNodes: FinalNodeLookup,
): DominatingNilCheckRewriteSession {
  const consumedGuards = new Set<Node>();
  const consumedBlocks = new Set<Node>();
  const initializers = new Map<DominatingNilCheckBindingPlan, Node>();
  let finished = false;
  return Object.freeze({
    rewrite(original: Node, updated: Node, factory: NodeFactory): Node | undefined {
      if (finished) {
        throw new Error("dominating nil-check rewrite is already sealed");
      }
      const binding = plan.bindingForGuard(original);
      if (binding !== undefined) {
        if (consumedGuards.has(original)) {
          throw new Error("dominating nil-check guard was rewritten twice");
        }
        consumedGuards.add(original);
        if (original === binding.anchorGuard) {
          if (initializers.has(binding)) {
            throw new Error("dominating nil-check initializer was captured twice");
          }
          initializers.set(binding, updated);
        }
        return requiredNode(
          NewIdentifier(factory, binding.checkedName.text),
          "checked pointer identifier",
        );
      }
      const bindings = plan.bindingsForBlock(original);
      if (bindings.length === 0) {
        return updated;
      }
      if (consumedBlocks.has(original)) {
        throw new Error("dominating nil-check block was rewritten twice");
      }
      consumedBlocks.add(original);
      return insertCheckedBindings(
        factory,
        updated,
        bindings,
        initializers,
        finalNodes,
      );
    },
    finish(sourceFile: SourceFile): DominatingNilCheckRewriteResult {
      if (finished) {
        throw new Error("dominating nil-check rewrite was sealed twice");
      }
      finished = true;
      if (
        consumedGuards.size !== plan.optimizedGuardCount ||
        consumedBlocks.size !== plan.blockCount ||
        initializers.size !== plan.bindingCount
      ) {
        throw new Error(
          `dominating nil-check consumption guards=${consumedGuards.size}/${plan.optimizedGuardCount} ` +
            `bindings=${initializers.size}/${plan.bindingCount}`,
        );
      }
      return Object.freeze({
        sourceFile,
        bindingCount: plan.bindingCount,
        optimizedGuardCount: plan.optimizedGuardCount,
        eliminatedGuardCount: plan.eliminatedGuardCount,
      });
    },
  });
}

function insertCheckedBindings(
  factory: NodeFactory,
  updated: Node,
  bindings: readonly DominatingNilCheckBindingPlan[],
  initializers: ReadonlyMap<DominatingNilCheckBindingPlan, Node>,
  finalNodes: FinalNodeLookup,
): Node {
  const block = AsBlock(updated);
  if (block === undefined) {
    throw new Error("dominating nil-check owner lost its block");
  }
  const statements = [...(block.Statements?.Nodes ?? [])];
  for (const binding of bindings) {
    const anchor = finalNodes.forOriginal(binding.anchorStatement);
    const initializer = initializers.get(binding);
    if (anchor === undefined || initializer === undefined) {
      throw new Error("dominating nil-check binding lost its exact anchor");
    }
    const anchorIndex = statements.indexOf(anchor);
    if (anchorIndex < 0) {
      throw new Error("dominating nil-check anchor left its selected block");
    }
    statements.splice(
      anchorIndex,
      0,
      createCheckedBinding(factory, binding.checkedName, initializer),
    );
  }
  return requiredNode(
    NodeFactory_UpdateBlock(
      factory,
      block,
      NodeFactory_NewNodeList(factory, statements),
      block.MultiLine,
    ),
    "block with dominating nil checks",
  );
}

function createCheckedBinding(
  factory: NodeFactory,
  name: GeneratedBindingName,
  initializer: Node,
): Node {
  const declaration = requiredNode(
    NewVariableDeclaration(
      factory,
      requiredNode(NewIdentifier(factory, name.text), "checked pointer name"),
      undefined,
      undefined,
      initializer,
    ),
    "checked pointer declaration",
  );
  const declarations = requiredNode(
    NewVariableDeclarationList(
      factory,
      NodeFactory_NewNodeList(factory, [declaration]),
      NodeFlagsConst,
    ),
    "checked pointer declaration list",
  );
  return requiredNode(
    NewVariableStatement(factory, undefined, declarations),
    "checked pointer statement",
  );
}

function requiredNode(node: Node | undefined, subject: string): Node {
  if (node === undefined) {
    throw new Error(`${subject} was not created`);
  }
  return node;
}
