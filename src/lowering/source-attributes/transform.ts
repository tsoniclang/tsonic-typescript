import type { Node, SourceFile } from "@tsonic/tsts";
import type {
  NodeFactory,
  TargetAstRewrite,
} from "@tsonic/tsts/target-ast";

import type { SourceAttributePlan } from "./plan.js";
import { pruneEmptyModuleBindingContainer } from "../module-bindings/prune-empty.js";

export interface SourceAttributeRewriteResult {
  readonly sourceFile: SourceFile;
  readonly erasedApplicationCount: number;
  readonly erasedImportBindingCount: number;
  readonly erasedDeclarationCount: number;
}

export interface SourceAttributeRewriter {
  readonly rewrite: TargetAstRewrite;
  finish(sourceFile: SourceFile): SourceAttributeRewriteResult;
}

export function createSourceAttributeRewriter(
  plan: SourceAttributePlan,
  sourceFile: SourceFile,
): SourceAttributeRewriter {
  const expected = plan.applicationsFor(sourceFile);
  const byStatement = new Set(expected.map((application) => application.statement));
  const expectedImports = plan.removableImportBindingsFor(sourceFile);
  const expectedDeclarations = plan.removableDeclarationsFor(sourceFile);
  const consumedApplications = new Set<Node>();
  const consumedImports = new Set<Node>();
  const consumedDeclarations = new Set<Node>();
  let finished = false;
  return Object.freeze({
    rewrite(
      original: Node,
      updated: Node,
      _factory: NodeFactory,
    ): Node | undefined {
      if (finished) {
        throw new Error("source attribute rewriter is already finished");
      }
      if (expectedImports.has(original)) {
        if (consumedImports.has(original)) {
          throw new Error("source attribute import binding was visited more than once");
        }
        consumedImports.add(original);
        return undefined;
      }
      if (expectedDeclarations.has(original)) {
        if (consumedDeclarations.has(original)) {
          throw new Error("source attribute fact declaration was visited more than once");
        }
        consumedDeclarations.add(original);
        return undefined;
      }
      if (!byStatement.has(original)) {
        return pruneEmptyModuleBindingContainer(original, updated);
      }
      if (consumedApplications.has(original)) {
        throw new Error("source attribute statement was visited more than once");
      }
      consumedApplications.add(original);
      return undefined;
    },
    finish(transformed: SourceFile): SourceAttributeRewriteResult {
      if (finished) {
        throw new Error("source attribute rewriter is already finished");
      }
      finished = true;
      const missing = expected.find((application) =>
        !consumedApplications.has(application.statement)
      );
      if (
        missing !== undefined ||
        consumedApplications.size !== expected.length
      ) {
        throw new Error(
          `source attribute consumption mismatch: planned ${expected.length}, consumed ${consumedApplications.size}`,
        );
      }
      if (consumedImports.size !== expectedImports.size) {
        throw new Error(
          `source attribute import consumption mismatch: planned ${expectedImports.size}, consumed ${consumedImports.size}`,
        );
      }
      if (consumedDeclarations.size !== expectedDeclarations.size) {
        throw new Error(
          `source attribute declaration consumption mismatch: planned ${expectedDeclarations.size}, consumed ${consumedDeclarations.size}`,
        );
      }
      return Object.freeze({
        sourceFile: transformed,
        erasedApplicationCount: consumedApplications.size,
        erasedImportBindingCount: consumedImports.size,
        erasedDeclarationCount: consumedDeclarations.size,
      });
    },
  });
}
