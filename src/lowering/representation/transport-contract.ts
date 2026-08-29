import { createHash } from "node:crypto";

export type RepresentationTransportKind = "generic-kernel";

export interface RepresentationTransportCallable {
  readonly kind: RepresentationTransportKind;
  readonly moduleSpecifier: string;
  readonly exportName: string;
}

export interface RepresentationTransportContract {
  readonly schemaVersion: 1;
  readonly digest: string;
  readonly callables: readonly RepresentationTransportCallable[];
}

const emptyContract = createRepresentationTransportContract([]);

export function canonicalRepresentationTransportContract(): RepresentationTransportContract {
  return emptyContract;
}

export function createRepresentationTransportContract(
  callables: readonly RepresentationTransportCallable[],
): RepresentationTransportContract {
  const sealed = Object.freeze(callables.map((callable) => Object.freeze({
    kind: callable.kind,
    moduleSpecifier: callable.moduleSpecifier,
    exportName: callable.exportName,
  })));
  for (let index = 0; index < sealed.length; index += 1) {
    const callable = sealed[index];
    if (
      callable === undefined ||
      callable.kind !== "generic-kernel" ||
      callable.moduleSpecifier.length === 0 ||
      callable.exportName.length === 0
    ) {
      throw new Error("representation transport callable identity is incomplete");
    }
    if (
      index > 0 &&
      compareRepresentationTransportCallables(sealed[index - 1], callable) >= 0
    ) {
      throw new Error(
        "representation transport callables must be uniquely and canonically ordered",
      );
    }
  }
  const document = Object.freeze({
    schemaVersion: 1 as const,
    callables: sealed,
  });
  const digest = createHash("sha256")
    .update(JSON.stringify(document))
    .digest("hex");
  return Object.freeze({ ...document, digest });
}

export function compareRepresentationTransportCallables(
  left: RepresentationTransportCallable | undefined,
  right: RepresentationTransportCallable | undefined,
): number {
  if (left === undefined || right === undefined) {
    throw new Error("representation transport comparison received no callable");
  }
  return compareText(left.moduleSpecifier, right.moduleSpecifier) ||
    compareText(left.exportName, right.exportName) ||
    compareText(left.kind, right.kind);
}

export function representationTransportCallableKey(
  callable: RepresentationTransportCallable,
): string {
  return JSON.stringify([
    callable.moduleSpecifier,
    callable.exportName,
    callable.kind,
  ]);
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
