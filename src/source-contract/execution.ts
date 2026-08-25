import type { Node, SourceFile } from "@tsonic/tsts";
import type { TargetSourceProgram } from "@tsonic/target-api/source";

import type { TargetProgramIndex } from "../lowering/program-index.js";

export type TypeScriptSourceExecutionProfile =
  | "unrestricted"
  | "synchronous";

export interface SourceExecutionViolation {
  readonly sourceFile: SourceFile;
  readonly node: Node;
  readonly message: string;
}

export function sourceExecutionViolations(
  source: TargetSourceProgram,
  program: TargetProgramIndex,
  profile: TypeScriptSourceExecutionProfile,
): readonly SourceExecutionViolation[] {
  if (profile === "unrestricted") {
    return Object.freeze([]);
  }
  if (profile !== "synchronous") {
    throw new Error(
      `unsupported TypeScript source execution profile '${String(profile)}'`,
    );
  }
  const violations: SourceExecutionViolation[] = [];
  for (const sourceFile of program.sourceFiles) {
    for (const node of program.nodesFor(sourceFile)) {
      if (!isSuspensionSyntax(source, node)) {
        continue;
      }
      violations.push(Object.freeze({
        sourceFile,
        node,
        message:
          `synchronous source contract rejects ${source.ast.kindName(node)}`,
      }));
    }
  }
  return Object.freeze(violations);
}

function isSuspensionSyntax(
  source: TargetSourceProgram,
  node: Node,
): boolean {
  if (
    source.ast.hasModifierKind(node, "async") ||
    source.ast.is.IsAwaitExpression(node) ||
    source.ast.variableDeclarationKind(node) === "await using"
  ) {
    return true;
  }
  return source.ast.is.IsForOfStatement(node) &&
    source.ast.as.AsForInOrOfStatement(node)?.AwaitModifier !== undefined;
}
