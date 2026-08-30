import type { Node, SourceFile } from "@tsonic/tsts";
import type { NodeFactory } from "@tsonic/tsts/target-ast";

import { pruneEmptyModuleSyntax } from "../module-syntax.js";
import type { ValueStructurePlan } from "./plan.js";

export interface ValueStructureLoweringResult {
  readonly sourceFile: SourceFile;
  readonly assertionCount: number;
  readonly removableDeclarationCount: number;
}

export interface ValueStructureRewriteSession {
  rewrite(
    original: Node,
    updated: Node,
    factory: NodeFactory,
  ): Node | undefined;
  finish(sourceFile: SourceFile): ValueStructureLoweringResult;
}

export function createValueStructureRewriteSession(
  plan: ValueStructurePlan,
  sourceFile: SourceFile,
): ValueStructureRewriteSession {
  const assertions = new Set(plan.assertionsFor(sourceFile));
  const declarations = new Set(plan.removableDeclarationsFor(sourceFile));
  const consumedAssertions = new Set<Node>();
  const consumedDeclarations = new Set<Node>();
  let finished = false;
  return Object.freeze({
    rewrite(
      original: Node,
      updated: Node,
      _factory: NodeFactory,
    ): Node | undefined {
      if (finished) {
        throw new Error("value-structure rewrite is already sealed");
      }
      if (assertions.has(original)) {
        consumedAssertions.add(original);
        return undefined;
      }
      if (declarations.has(original)) {
        consumedDeclarations.add(original);
        return undefined;
      }
      return pruneEmptyModuleSyntax(original, updated);
    },
    finish(transformed: SourceFile): ValueStructureLoweringResult {
      if (finished) {
        throw new Error("value-structure rewrite was sealed twice");
      }
      finished = true;
      assertCount("assertions", consumedAssertions.size, assertions.size);
      assertCount(
        "marker declarations",
        consumedDeclarations.size,
        declarations.size,
      );
      return Object.freeze({
        sourceFile: transformed,
        assertionCount: consumedAssertions.size,
        removableDeclarationCount: consumedDeclarations.size,
      });
    },
  });
}

function assertCount(subject: string, actual: number, expected: number): void {
  if (actual !== expected) {
    throw new Error(
      `consumed ${actual} value-structure ${subject}, expected ${expected}`,
    );
  }
}
