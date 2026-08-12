import type { Node } from "@tsonic/tsts";
import type { TargetSourceProgram } from "@tsonic/target-api";

export function collectTargetProgramNodes(
  source: TargetSourceProgram,
): readonly Node[] {
  const nodes: Node[] = [];
  const seen = new Set<Node>();
  for (const sourceFile of source.navigation.sourceFiles) {
    const pending: Node[] = [sourceFile];
    while (pending.length !== 0) {
      const node = pending.pop();
      if (node === undefined || seen.has(node)) {
        continue;
      }
      seen.add(node);
      nodes.push(node);
      const children = source.ast.children(node);
      for (let index = children.length - 1; index >= 0; index -= 1) {
        const child = children[index];
        if (child !== undefined) {
          pending.push(child);
        }
      }
    }
  }
  return Object.freeze(nodes);
}
