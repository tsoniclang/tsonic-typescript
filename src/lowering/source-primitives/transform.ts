import type { Node, SourceFile } from "@tsonic/tsts";
import {
  KindBigIntKeyword,
  KindBooleanKeyword,
  KindNumberKeyword,
  KindObjectKeyword,
  KindStringKeyword,
  NewKeywordTypeNode,
  transformTargetSourceFile,
} from "@tsonic/tsts/target-ast";
import type {
  NodeFactory,
  TargetAstRewrite,
} from "@tsonic/tsts/target-ast";

import type {
  SourcePrimitiveLoweringPlan,
  TypeScriptPrimitiveKind,
} from "./plan.js";
import { finalizeModuleBindingRewrite } from "../module-bindings/finalize.js";

export interface SourcePrimitiveRewriteResult {
  readonly sourceFile: SourceFile;
  readonly typeReferenceCount: number;
  readonly erasedImportBindingCount: number;
}

export interface SourcePrimitiveRewriter {
  readonly rewrite: TargetAstRewrite;
  removesModuleBinding(node: Node): boolean;
  finish(sourceFile: SourceFile): SourcePrimitiveRewriteResult;
}

export function createSourcePrimitiveRewriter(
  plan: SourcePrimitiveLoweringPlan,
  sourceFile: SourceFile,
): SourcePrimitiveRewriter {
  const expectedRewrites = plan.rewritesFor(sourceFile);
  const expectedBindings = plan.removableImportBindingsFor(sourceFile);
  const consumedRewrites = new Set<Node>();
  const consumedBindings = new Set<Node>();
  let finished = false;
  return Object.freeze({
    rewrite(
      original: Node,
      updated: Node,
      factory: NodeFactory,
    ): Node | undefined {
      if (finished) {
        throw new Error("source primitive rewriter is already finished");
      }
      if (expectedBindings.has(original)) {
        consumedBindings.add(original);
        return updated;
      }
      const selected = plan.rewriteFor(original);
      if (selected === undefined) {
        return updated;
      }
      if (consumedRewrites.has(original)) {
        throw new Error("source primitive type was visited more than once");
      }
      consumedRewrites.add(original);
      return requiredNode(
        NewKeywordTypeNode(factory, primitiveKeyword(selected.primitive)),
        `source primitive ${selected.fact.kind}`,
      );
    },
    removesModuleBinding(node: Node): boolean {
      return expectedBindings.has(node);
    },
    finish(transformed: SourceFile): SourcePrimitiveRewriteResult {
      if (finished) {
        throw new Error("source primitive rewriter was sealed twice");
      }
      finished = true;
      assertExactConsumption(
        "type references",
        consumedRewrites,
        expectedRewrites.length,
      );
      assertExactConsumption(
        "import bindings",
        consumedBindings,
        expectedBindings.size,
      );
      return Object.freeze({
        sourceFile: transformed,
        typeReferenceCount: consumedRewrites.size,
        erasedImportBindingCount: consumedBindings.size,
      });
    },
  });
}

export function lowerSourcePrimitives(
  sourceFile: SourceFile,
  plan: SourcePrimitiveLoweringPlan,
): SourcePrimitiveRewriteResult {
  const rewriter = createSourcePrimitiveRewriter(plan, sourceFile);
  const transformed = transformTargetSourceFile(
    sourceFile,
    (original, updated, factory) => {
      const rewritten = rewriter.rewrite(original, updated, factory);
      return rewritten === undefined ? undefined : finalizeModuleBindingRewrite(
        original,
        rewritten,
        rewriter.removesModuleBinding(original),
      );
    },
  );
  return rewriter.finish(transformed);
}

function primitiveKeyword(primitive: TypeScriptPrimitiveKind) {
  switch (primitive) {
    case "bigint":
      return KindBigIntKeyword;
    case "boolean":
      return KindBooleanKeyword;
    case "number":
      return KindNumberKeyword;
    case "object":
      return KindObjectKeyword;
    case "string":
      return KindStringKeyword;
  }
}

function requiredNode(node: Node | undefined, subject: string): Node {
  if (node === undefined) {
    throw new Error(`failed to construct ${subject} target type`);
  }
  return node;
}

function assertExactConsumption(
  subject: string,
  consumed: ReadonlySet<Node>,
  expected: number,
): void {
  if (consumed.size !== expected) {
    throw new Error(
      `source primitive ${subject} consumption mismatch: planned ${expected}, consumed ${consumed.size}`,
    );
  }
}
