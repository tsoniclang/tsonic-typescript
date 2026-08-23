import type { Node } from "@tsonic/tsts";
import type { TargetSourceProgram } from "@tsonic/target-api/source";

const exactSemanticMembership = new WeakMap<
  TargetSourceProgram,
  WeakMap<Node, boolean>
>();

export function nodeHasExactSourceSemantics(
  source: TargetSourceProgram,
  node: Node,
): boolean {
  let byNode = exactSemanticMembership.get(source);
  if (byNode === undefined) {
    byNode = new WeakMap<Node, boolean>();
    exactSemanticMembership.set(source, byNode);
  }
  const existing = byNode.get(node);
  if (existing !== undefined) {
    return existing;
  }
  const sourceFile = source.ast.getSourceFile(node);
  const included = sourceFile !== undefined &&
    source.semantics.includes(sourceFile);
  byNode.set(node, included);
  return included;
}
