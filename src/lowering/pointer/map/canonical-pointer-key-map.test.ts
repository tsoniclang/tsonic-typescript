import assert from "node:assert/strict";
import { test } from "node:test";

import type { Node } from "@tsonic/tsts";
import {
  AsObjectLiteralExpression,
  IsClassDeclaration,
  IsMethodDeclaration,
  IsObjectLiteralExpression,
  IsPropertyAssignment,
  IsPropertyDeclaration,
} from "@tsonic/tsts/target-ast";

import {
  checkedPointerFixture,
  countCallsNamed,
  createFixturePointerFlowPlan,
  visit,
} from "../pointer.test-support.js";
import { lowerPointers } from "../transform.js";

test("contracts exact canonical pointer-key map storage", () => {
  const fixture = checkedPointerFixture(pointerMapSource());
  const plan = createFixturePointerFlowPlan(fixture.source);

  assert.equal(plan.optimizedPointerKeyMapCount, 1);
  const lowered = lowerPointers(fixture.source, fixture.sourceFile, plan);
  assert.equal(countCallsNamed(fixture.source, lowered.sourceFile, "hashLocation"), 0);
  assert.equal(countCallsNamed(fixture.source, lowered.sourceFile, "sameLocation"), 0);
  assert.deepEqual(
    classNames(fixture.source, lowered.sourceFile).filter((name) =>
      name.startsWith("$PointerMapStorage")
    ),
    ["$PointerMapStorage"],
  );
});

test("uses one ordered value ledger and only private property tokens", () => {
  const fixture = checkedPointerFixture(pointerMapSource());
  const plan = createFixturePointerFlowPlan(fixture.source);
  const lowered = lowerPointers(fixture.source, fixture.sourceFile, plan);
  const storage = classDeclarationNamed(
    fixture.source,
    lowered.sourceFile,
    "$PointerMapStorage",
  );

  assert.deepEqual(
    fixture.source.ast.members(storage)
      .filter((member) =>
        member !== undefined &&
        (IsPropertyDeclaration(member) || IsMethodDeclaration(member))
      )
      .map((member) => fixture.source.ast.text(fixture.source.ast.name(member))),
    ["values", "propertyIdentities", "get", "set", "delete", "clear", "values"],
  );
  assert.equal(countNamedNodes(fixture.source, storage, "ordered"), 0);
  assert.equal(countValueEntryWrappers(fixture.source, storage), 0);
});

test("rejects a partial pointer-hash container", () => {
  const fixture = checkedPointerFixture(`
import type { Pointer } from "./markers.js";
import { hashPointer } from "./markers.js";
class Partial {
  static hash(key: Pointer<number> | undefined): number {
    return hashPointer(key);
  }
}
export { Partial };
`);
  const plan = createFixturePointerFlowPlan(fixture.source);

  assert.equal(plan.optimizedPointerKeyMapCount, 0);
});

test("ignores exact pointer operations outside the generated map contract", () => {
  const fixture = checkedPointerFixture(`
import type { Pointer } from "./markers.js";
import { equalPointer, hashPointer } from "./markers.js";
const key: Pointer<number> | undefined = undefined;
export const hash = hashPointer(key);
export const equal = equalPointer(key, key);
`);

  assert.equal(
    createFixturePointerFlowPlan(fixture.source).optimizedPointerKeyMapCount,
    0,
  );
});

test("rejects same-spelled local pointer helpers without selected facts", () => {
  const fixture = checkedPointerFixture(`
interface Pointer<T> { value: T }
function hashPointer<T>(_key: Pointer<T> | undefined): number { return 0; }
function equalPointer<T>(left: Pointer<T> | undefined, right: Pointer<T> | undefined): boolean {
  return left === right;
}
class Ordinary {
  private static hash(key: Pointer<number> | undefined): number {
    return hashPointer(key);
  }
  private static equal(left: Pointer<number> | undefined, right: Pointer<number> | undefined): boolean {
    return equalPointer(left, right);
  }
}
export { Ordinary };
`);

  assert.equal(
    createFixturePointerFlowPlan(fixture.source).optimizedPointerKeyMapCount,
    0,
  );
});

test("rejects a class with duplicate exact hash owners", () => {
  const source = pointerMapSource().replace(
    "  private static equal(left: Key, right: Key): boolean {",
    `  private static duplicateHash(key: Key): number { return hashPointer(key); }
  private static equal(left: Key, right: Key): boolean {`,
  );
  const fixture = checkedPointerFixture(source);

  assert.equal(
    createFixturePointerFlowPlan(fixture.source).optimizedPointerKeyMapCount,
    0,
  );
});

test("reserves the module helper against every authored binding", () => {
  const source = pointerMapSource().replace(
    "abstract class MapValue",
    "class $PointerMapStorage {}\nabstract class MapValue",
  );
  const fixture = checkedPointerFixture(source);
  const plan = createFixturePointerFlowPlan(fixture.source);
  const lowered = lowerPointers(fixture.source, fixture.sourceFile, plan);

  assert.equal(plan.optimizedPointerKeyMapCount, 1);
  assert.deepEqual(
    classNames(fixture.source, lowered.sourceFile).filter((name) =>
      name.startsWith("$PointerMapStorage")
    ).sort(),
    ["$PointerMapStorage", "$PointerMapStorage2"],
  );
});

test("accepts the checked no-argument construction with omitted parentheses", () => {
  const source = pointerMapSource().replace(
    "new Map<number, [Key, number][]>(),",
    "new Map<number, [Key, number][]>,",
  );
  const fixture = checkedPointerFixture(source);
  const plan = createFixturePointerFlowPlan(fixture.source);

  assert.equal(plan.optimizedPointerKeyMapCount, 1);
  assert.doesNotThrow(() =>
    lowerPointers(fixture.source, fixture.sourceFile, plan)
  );
});

function classNames(
  source: ReturnType<typeof checkedPointerFixture>["source"],
  root: Node,
): readonly string[] {
  const names: string[] = [];
  visit(source, root, (node) => {
    if (!IsClassDeclaration(node)) {
      return;
    }
    const name = source.ast.name(node);
    if (name !== undefined) {
      names.push(source.ast.text(name));
    }
  });
  return names;
}

function classDeclarationNamed(
  source: ReturnType<typeof checkedPointerFixture>["source"],
  root: Node,
  expectedName: string,
): Node {
  let result: Node | undefined;
  visit(source, root, (node) => {
    if (
      IsClassDeclaration(node) &&
      source.ast.text(source.ast.name(node)) === expectedName
    ) {
      assert.equal(result, undefined);
      result = node;
    }
  });
  assert.ok(result !== undefined);
  return result;
}

function countNamedNodes(
  source: ReturnType<typeof checkedPointerFixture>["source"],
  root: Node,
  expectedName: string,
): number {
  let count = 0;
  visit(source, root, (node) => {
    const name = source.ast.name(node);
    if (name !== undefined && source.ast.text(name) === expectedName) {
      count += 1;
    }
  });
  return count;
}

function countValueEntryWrappers(
  source: ReturnType<typeof checkedPointerFixture>["source"],
  root: Node,
): number {
  let count = 0;
  visit(source, root, (node) => {
    if (!IsObjectLiteralExpression(node)) {
      return;
    }
    const hasValueProperty = (AsObjectLiteralExpression(node)?.Properties?.Nodes ?? []).some((member) =>
      member !== undefined &&
      IsPropertyAssignment(member) &&
      source.ast.text(source.ast.name(member)) === "value"
    );
    if (hasValueProperty) {
      count += 1;
    }
  });
  return count;
}

function pointerMapSource(): string {
  return `
import type { Pointer } from "./markers.js";
import { equalPointer, hashPointer } from "./markers.js";

abstract class MapValue<K, V> {
  abstract lookup(key: K): V;
  abstract lookupOk(key: K): [V, boolean];
  abstract store(key: K, value: V): void;
  abstract delete(key: K): void;
  abstract length(): number;
  abstract isNil(): boolean;
  abstract clear(): void;
  abstract keys(): K[];
}

class Box {
  constructor(readonly value: number) {}
}

type Key = Pointer<Box> | undefined;
type Entry = [Key, number];

class PointerMap extends MapValue<Key, number> {
  private constructor(
    private readonly zeroValue: number,
    private readonly buckets: Map<number, [Key, number][]> | undefined,
    private count: number,
  ) { super(); }

  private static zero(): number { return 0; }
  private static hash(key: Key): number { return hashPointer(key); }
  private static equal(left: Key, right: Key): boolean {
    return equalPointer(left, right);
  }
  private static copyKey(key: Key): Key { return key; }
  private static copyValue(value: number): number { return value; }

  static nil(): PointerMap {
    return new PointerMap(PointerMap.zero(), undefined, 0);
  }
  static make(entries: Entry[]): PointerMap {
    const result = new PointerMap(
      PointerMap.zero(),
      new Map<number, [Key, number][]>(),
      0,
    );
    for (const entry of entries) { result.store(entry[0], entry[1]); }
    return result;
  }

  private find(key: Key): [Entry, Entry[], number] | undefined {
    const buckets = this.buckets;
    if (buckets === undefined) { return undefined; }
    const bucket = buckets.get(PointerMap.hash(key));
    if (bucket === undefined) { return undefined; }
    let index = 0;
    for (const entry of bucket) {
      if (PointerMap.equal(entry[0], key)) { return [entry, bucket, index]; }
      index++;
    }
    return undefined;
  }

  lookup(key: Key): number {
    const found = this.find(key);
    return PointerMap.copyValue(found === undefined ? this.zeroValue : found[0][1]);
  }
  lookupOk(key: Key): [number, boolean] {
    const found = this.find(key);
    if (found === undefined) { return [PointerMap.copyValue(this.zeroValue), false]; }
    return [PointerMap.copyValue(found[0][1]), true];
  }
  store(key: Key, value: number): void {
    const buckets: Map<number, Entry[]> | undefined = this.buckets;
    if (buckets === undefined) { throw new Error("assignment to entry in nil map"); }
    const hash = PointerMap.hash(key);
    let bucket = buckets.get(hash);
    if (bucket === undefined) { bucket = []; buckets.set(hash, bucket); }
    for (const entry of bucket) {
      if (PointerMap.equal(entry[0], key)) {
        entry[1] = PointerMap.copyValue(value);
        return;
      }
    }
    bucket.push([PointerMap.copyKey(key), PointerMap.copyValue(value)]);
    this.count++;
  }
  delete(key: Key): void {
    const found = this.find(key);
    if (found === undefined) { return; }
    found[1].splice(found[2], 1);
    if (found[1].length === 0 && this.buckets !== undefined) {
      this.buckets.delete(PointerMap.hash(key));
    }
    this.count--;
  }
  length(): number { return this.count; }
  isNil(): boolean { return this.buckets === undefined; }
  clear(): void {
    if (this.buckets === undefined) { return; }
    this.buckets.clear();
    this.count = 0;
  }
  keys(): Key[] {
    const result: Key[] = [];
    const buckets: Map<number, Entry[]> | undefined = this.buckets;
    if (buckets === undefined) { return result; }
    for (const bucket of buckets.values()) {
      for (const entry of bucket) { result.push(entry[0]); }
    }
    return result;
  }
}

export { Box, PointerMap };
`;
}
