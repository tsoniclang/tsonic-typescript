import { createHash } from "node:crypto";

export type RepresentationTransportKind =
  | "generic-kernel"
  | "generated-generic-function-kernel"
  | "generated-generic-member-kernel";

export interface ProviderRepresentationTransportCallable {
  readonly kind: "generic-kernel";
  readonly moduleSpecifier: string;
  readonly exportName: string;
}

export interface GeneratedFunctionRepresentationTransportCallable {
  readonly kind: "generated-generic-function-kernel";
  readonly sourcePath: string;
  readonly exportName: string;
}

export interface GeneratedMemberRepresentationTransportCallable {
  readonly kind: "generated-generic-member-kernel";
  readonly sourcePath: string;
  readonly exportName: string;
  readonly memberName: string;
}

export type RepresentationTransportCallable =
  | ProviderRepresentationTransportCallable
  | GeneratedFunctionRepresentationTransportCallable
  | GeneratedMemberRepresentationTransportCallable;

export interface RepresentationTransportContract {
  readonly schemaVersion: 2;
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
  const sealed = Object.freeze(callables.map(sealCallable));
  for (let index = 0; index < sealed.length; index += 1) {
    const callable = sealed[index];
    if (callable === undefined || !validCallable(callable)) {
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
    schemaVersion: 2 as const,
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
  return compareText(left.kind, right.kind) || compareSameKind(left, right);
}

export function representationTransportCallableKey(
  callable: RepresentationTransportCallable,
): string {
  switch (callable.kind) {
    case "generic-kernel":
      return JSON.stringify([
        callable.kind,
        callable.moduleSpecifier,
        callable.exportName,
      ]);
    case "generated-generic-function-kernel":
      return JSON.stringify([
        callable.kind,
        callable.sourcePath,
        callable.exportName,
      ]);
    case "generated-generic-member-kernel":
      return JSON.stringify([
        callable.kind,
        callable.sourcePath,
        callable.exportName,
        callable.memberName,
      ]);
  }
}

function sealCallable(
  callable: RepresentationTransportCallable,
): RepresentationTransportCallable {
  switch (callable.kind) {
    case "generic-kernel":
      return Object.freeze({
        kind: callable.kind,
        moduleSpecifier: callable.moduleSpecifier,
        exportName: callable.exportName,
      });
    case "generated-generic-function-kernel":
      return Object.freeze({
        kind: callable.kind,
        sourcePath: callable.sourcePath,
        exportName: callable.exportName,
      });
    case "generated-generic-member-kernel":
      return Object.freeze({
        kind: callable.kind,
        sourcePath: callable.sourcePath,
        exportName: callable.exportName,
        memberName: callable.memberName,
      });
  }
}

function validCallable(callable: RepresentationTransportCallable): boolean {
  switch (callable.kind) {
    case "generic-kernel":
      return callable.moduleSpecifier.length !== 0 && callable.exportName.length !== 0;
    case "generated-generic-function-kernel":
      return callable.sourcePath.length !== 0 && callable.exportName.length !== 0;
    case "generated-generic-member-kernel":
      return callable.sourcePath.length !== 0 && callable.exportName.length !== 0 &&
        callable.memberName.length !== 0;
  }
}

function compareSameKind(
  left: RepresentationTransportCallable,
  right: RepresentationTransportCallable,
): number {
  if (left.kind !== right.kind) {
    return 0;
  }
  switch (left.kind) {
    case "generic-kernel": {
      const selected = right as ProviderRepresentationTransportCallable;
      return compareText(left.moduleSpecifier, selected.moduleSpecifier) ||
        compareText(left.exportName, selected.exportName);
    }
    case "generated-generic-function-kernel": {
      const selected = right as GeneratedFunctionRepresentationTransportCallable;
      return compareText(left.sourcePath, selected.sourcePath) ||
        compareText(left.exportName, selected.exportName);
    }
    case "generated-generic-member-kernel": {
      const selected = right as GeneratedMemberRepresentationTransportCallable;
      return compareText(left.sourcePath, selected.sourcePath) ||
        compareText(left.exportName, selected.exportName) ||
        compareText(left.memberName, selected.memberName);
    }
  }
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
