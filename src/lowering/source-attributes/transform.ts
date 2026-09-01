import type { Node, SourceFile } from "@tsonic/tsts";
import type {
  NodeFactory,
  TargetAstRewrite,
} from "@tsonic/tsts/target-ast";
import {
  AsImportDeclaration,
  IsImportDeclaration,
  NodeFactory_UpdateImportDeclaration,
} from "@tsonic/tsts/target-ast";

import type { SourceAttributePlan } from "./plan.js";
import { pruneEmptyModuleBindingContainer } from "../module-bindings/prune-empty.js";

export interface SourceAttributeRewriteResult {
  readonly sourceFile: SourceFile;
  readonly erasedApplicationCount: number;
  readonly erasedImportBindingCount: number;
  readonly erasedDeclarationCount: number;
  readonly preservedModuleEvaluationImportCount: number;
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
  const deferredImports = plan.deferredImportBindingsFor(sourceFile);
  const expectedDeclarations = plan.removableDeclarationsFor(sourceFile);
  const expectedModuleEvaluationImports = plan.moduleEvaluationImportsFor(sourceFile);
  const consumedApplications = new Set<Node>();
  const consumedImports = new Set<Node>();
  const consumedDeclarations = new Set<Node>();
  const consumedModuleEvaluationImports = new Set<Node>();
  let preservedModuleEvaluationImportCount = 0;
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
        if (deferredImports.has(original)) {
          return updated;
        }
        return undefined;
      }
      if (expectedDeclarations.has(original)) {
        if (consumedDeclarations.has(original)) {
          throw new Error("source attribute fact declaration was visited more than once");
        }
        consumedDeclarations.add(original);
        return undefined;
      }
      if (expectedModuleEvaluationImports.has(original)) {
        if (consumedModuleEvaluationImports.has(original)) {
          throw new Error(
            "source attribute module-evaluation import was visited more than once",
          );
        }
        if (!IsImportDeclaration(original) || !IsImportDeclaration(updated)) {
          throw new Error(
            "source attribute module-evaluation import lost its declaration shape",
          );
        }
        consumedModuleEvaluationImports.add(original);
        const declaration = AsImportDeclaration(updated);
        if (declaration === undefined) {
          throw new Error(
            "source attribute module-evaluation import has no declaration",
          );
        }
        const preserved = NodeFactory_UpdateImportDeclaration(
          _factory,
          declaration,
          declaration.modifiers,
          undefined,
          declaration.ModuleSpecifier,
          declaration.Attributes,
        );
        if (preserved === undefined) {
          throw new Error(
            "source attribute module-evaluation import could not be preserved",
          );
        }
        preservedModuleEvaluationImportCount += 1;
        return preserved;
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
      if (
        consumedModuleEvaluationImports.size !==
          expectedModuleEvaluationImports.size
      ) {
        throw new Error(
          `source attribute module-evaluation import consumption mismatch: planned ${expectedModuleEvaluationImports.size}, consumed ${consumedModuleEvaluationImports.size}`,
        );
      }
      return Object.freeze({
        sourceFile: transformed,
        erasedApplicationCount: consumedApplications.size,
        erasedImportBindingCount: consumedImports.size,
        erasedDeclarationCount: consumedDeclarations.size,
        preservedModuleEvaluationImportCount,
      });
    },
  });
}
