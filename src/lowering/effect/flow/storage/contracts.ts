import type { Node } from "@tsonic/tsts";
import type { TargetSourceProgram } from "@tsonic/target-api/source";

import {
  type CallableReturnRewrite,
} from "../../model/callable-contract.js";
import {
  callableDeclarationSynchronousReturnTypes,
} from "../../model/callable-contract/declarations.js";

export interface CallableStorageContract {
  readonly declarations: readonly Node[];
  readonly returnTypes: readonly CallableReturnRewrite[];
}

export function createCallableStorageContracts(
  source: TargetSourceProgram,
  declarations: ReadonlySet<Node>,
  destinationMaps: readonly ReadonlyMap<Node, ReadonlySet<Node>>[],
): readonly CallableStorageContract[] {
  const neighbors = new Map<Node, Set<Node>>();
  for (const declaration of declarations) {
    neighbors.set(declaration, new Set());
  }
  for (const destinations of destinationMaps) {
    for (const [sourceDeclaration, targets] of destinations) {
      if (!declarations.has(sourceDeclaration)) {
        continue;
      }
      for (const target of targets) {
        if (declarations.has(target)) {
          append(neighbors, sourceDeclaration, target);
          append(neighbors, target, sourceDeclaration);
        }
      }
    }
  }
  const pending = new Set(declarations);
  const contracts: CallableStorageContract[] = [];
  while (pending.size !== 0) {
    const first = pending.values().next().value;
    if (first === undefined) {
      throw new Error("callable storage component lost its pending declaration");
    }
    const component: Node[] = [];
    const work = [first];
    pending.delete(first);
    while (work.length !== 0) {
      const declaration = work.pop();
      if (declaration === undefined) {
        continue;
      }
      component.push(declaration);
      for (const neighbor of neighbors.get(declaration) ?? []) {
        if (pending.delete(neighbor)) {
          work.push(neighbor);
        }
      }
    }
    const returnTypes = component.flatMap((declaration) =>
      callableDeclarationSynchronousReturnTypes(source, declaration) ?? []
    );
    if (returnTypes.length !== 0) {
      contracts.push(Object.freeze({
        declarations: Object.freeze(component),
        returnTypes: Object.freeze(returnTypes),
      }));
    }
  }
  return Object.freeze(contracts);
}

function append(target: Map<Node, Set<Node>>, key: Node, value: Node): void {
  const values = target.get(key);
  if (values === undefined) {
    target.set(key, new Set([value]));
  } else {
    values.add(value);
  }
}
