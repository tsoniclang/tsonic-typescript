import type { Node } from "@tsonic/tsts";

export function collectInterfaceContractComponent(
  seed: Node,
  links: ReadonlyMap<Node, ReadonlySet<Node>>,
  visited: Set<Node>,
): readonly Node[] {
  const result: Node[] = [];
  const pending = [seed];
  while (pending.length !== 0) {
    const declaration = pending.pop();
    if (declaration === undefined || visited.has(declaration)) {
      continue;
    }
    visited.add(declaration);
    result.push(declaration);
    for (const linked of links.get(declaration) ?? []) {
      pending.push(linked);
    }
  }
  return result;
}
