import assert from "node:assert/strict";
import { test } from "node:test";

import type { Node } from "@tsonic/tsts";
import {
  AsNewExpression,
  IsClassDeclaration,
  IsNewExpression,
} from "@tsonic/tsts/target-ast";

import {
  checkedPointerFixture,
  countCallsNamed,
  createFixturePointerFlowPlan,
  visit,
} from "./pointer.test-support.js";
import { lowerPointers } from "./transform.js";

test("fuses exact projected property and element locations", () => {
  const fixture = checkedPointerFixture(`
import type { Pointer } from "./markers.js";
import {
  addressOf,
  equalPointer,
  loadPointer,
  projectPointer,
  storePointer,
} from "./markers.js";

const $ProjectedPropertyLocation = "authored";
const record = { value: 1 };
const values = [2];
const property: Pointer<string> = projectPointer<number, string>(
  addressOf(record.value),
  String,
  Number,
)!;
const element: Pointer<string> = projectPointer<number, string>(
  addressOf(values[0]),
  String,
  Number,
)!;
export const same = equalPointer(property, property) &&
  equalPointer(element, element);
export const before = [loadPointer(property), loadPointer(element)];
storePointer(property, "3");
storePointer(element, "4");
export const after = [record.value, values[0], $ProjectedPropertyLocation];
`);
  const plan = createFixturePointerFlowPlan(fixture.source);

  assert.equal(plan.optimizedProjectedPropertyLocationCount, 2);
  const lowered = lowerPointers(fixture.source, fixture.sourceFile, plan);
  assert.equal(countCallsNamed(fixture.source, lowered.sourceFile, "projectLocation"), 0);
  assert.equal(countCallsNamed(fixture.source, lowered.sourceFile, "propertyLocation"), 0);
  assert.deepEqual(generatedClassNames(fixture, lowered.sourceFile), [
    "$ProjectedPropertyLocation2",
  ]);
  assert.equal(
    newExpressionsNamed(
      fixture,
      lowered.sourceFile,
      "$ProjectedPropertyLocation2",
    ).length,
    2,
  );
});

test("preserves owner, key, and converter evaluation order", () => {
  const fixture = checkedPointerFixture(`
import type { Pointer } from "./markers.js";
import { addressOf, hashPointer, projectPointer } from "./markers.js";

const trace: string[] = [];
const record = { value: 1 };
function owner(): typeof record { trace.push("owner"); return record; }
function key(): "value" { trace.push("key"); return "value"; }
function from(): (value: number) => string {
  trace.push("from");
  return String;
}
function to(): (value: string) => number {
  trace.push("to");
  return Number;
}
const projected: Pointer<string> = projectPointer<number, string>(
  addressOf(owner()[key()]),
  from(),
  to(),
)!;
export const identity = hashPointer(projected);
export { trace };
`);
  const plan = createFixturePointerFlowPlan(fixture.source);

  assert.equal(plan.optimizedProjectedPropertyLocationCount, 1);
  const lowered = lowerPointers(fixture.source, fixture.sourceFile, plan);
  const constructions = newExpressionsNamed(
    fixture,
    lowered.sourceFile,
    "$ProjectedPropertyLocation",
  );
  assert.equal(constructions.length, 1);
  const arguments_ = AsNewExpression(constructions[0])?.Arguments?.Nodes ?? [];
  assert.deepEqual(
    arguments_.map((argument) => callName(fixture, argument)),
    ["owner", "key", "from", "to"],
  );
});

test("retains nested, mutable-root, and nullable projections", () => {
  const cases = [
    `
import type { Pointer } from "./markers.js";
import { addressOf, hashPointer, projectPointer } from "./markers.js";
const wrapper = { record: { value: 1 } };
const projected = projectPointer<number, string>(
  addressOf(wrapper.record.value), String, Number,
)!;
export const result = hashPointer(projected);
`,
    `
import type { Pointer } from "./markers.js";
import { addressOf, hashPointer, projectPointer } from "./markers.js";
let record = { value: 1 };
const projected = projectPointer<number, string>(
  addressOf(record.value), String, Number,
)!;
export const result = hashPointer(projected);
`,
    `
import type { Pointer } from "./markers.js";
import { addressOf, hashPointer, projectPointer } from "./markers.js";
const record = { value: 1 };
const projected = projectPointer<number, string>(
  addressOf(record.value) as Pointer<number> | undefined,
  String,
  Number,
)!;
export const result = hashPointer(projected);
`,
  ] as const;

  for (const sourceText of cases) {
    const fixture = checkedPointerFixture(sourceText);
    const plan = createFixturePointerFlowPlan(fixture.source);
    assert.equal(plan.optimizedProjectedPropertyLocationCount, 0);
    const lowered = lowerPointers(fixture.source, fixture.sourceFile, plan);
    assert.equal(
      countCallsNamed(fixture.source, lowered.sourceFile, "projectLocation"),
      1,
    );
    assert.deepEqual(generatedClassNames(fixture, lowered.sourceFile), []);
  }
});

test("the fused location preserves live storage and pointer identity", () => {
  const canonical = canonicalProjectedPropertyScenario();
  const fused = fusedProjectedPropertyScenario();

  assert.deepEqual(fused, canonical);
});

function generatedClassNames(
  fixture: ReturnType<typeof checkedPointerFixture>,
  root: Node,
): readonly string[] {
  const names: string[] = [];
  visit(fixture.source, root, (node) => {
    if (!IsClassDeclaration(node)) {
      return;
    }
    const name = fixture.source.ast.name(node);
    if (name !== undefined && fixture.source.ast.text(name).startsWith(
      "$ProjectedPropertyLocation",
    )) {
      names.push(fixture.source.ast.text(name));
    }
  });
  return names;
}

function newExpressionsNamed(
  fixture: ReturnType<typeof checkedPointerFixture>,
  root: Node,
  name: string,
): readonly Node[] {
  const selected: Node[] = [];
  visit(fixture.source, root, (node) => {
    if (!IsNewExpression(node)) {
      return;
    }
    const expression = AsNewExpression(node)?.Expression;
    if (expression !== undefined && fixture.source.ast.text(expression) === name) {
      selected.push(node);
    }
  });
  return selected;
}

function callName(
  fixture: ReturnType<typeof checkedPointerFixture>,
  node: Node | undefined,
): string | undefined {
  if (node === undefined || !fixture.source.ast.is.IsCallExpression(node)) {
    return undefined;
  }
  const expression = fixture.source.ast.as.AsCallExpression(node)?.Expression;
  return expression === undefined ? undefined : fixture.source.ast.text(expression);
}

interface ScenarioResult {
  readonly before: string;
  readonly after: number;
  readonly same: boolean;
  readonly stableAfterReplacement: string;
  readonly trace: readonly string[];
}

interface TestLocation<T> {
  readonly storageIdentity: object;
  readonly storageKey: PropertyKey | undefined;
  value: T;
}

function canonicalProjectedPropertyScenario(): ScenarioResult {
  const trace: string[] = [];
  const original = { value: 1 };
  let current = original;
  const owner = (): typeof original => {
    trace.push("owner");
    return current;
  };
  const key = (): "value" => {
    trace.push("key");
    return "value";
  };
  const from = (): ((value: number) => string) => {
    trace.push("from");
    return String;
  };
  const to = (): ((value: string) => number) => {
    trace.push("to");
    return Number;
  };
  const property = propertyLocation(owner(), key());
  const location = projectedLocation(property, from(), to());
  const same = sameTestLocation(
    location,
    projectedLocation(propertyLocation(original, "value"), String, Number),
  );
  const before = location.value;
  location.value = "7";
  current = { value: 9 };
  return {
    before,
    after: original.value,
    same,
    stableAfterReplacement: location.value,
    trace,
  };
}

function fusedProjectedPropertyScenario(): ScenarioResult {
  const trace: string[] = [];
  const original = { value: 1 };
  let current = original;
  const owner = (): typeof original => {
    trace.push("owner");
    return current;
  };
  const key = (): "value" => {
    trace.push("key");
    return "value";
  };
  const from = (): ((value: number) => string) => {
    trace.push("from");
    return String;
  };
  const to = (): ((value: string) => number) => {
    trace.push("to");
    return Number;
  };
  const location = new TestProjectedPropertyLocation(
    owner(),
    key(),
    from(),
    to(),
  );
  const same = sameTestLocation(
    location,
    new TestProjectedPropertyLocation(original, "value", String, Number),
  );
  const before = location.value;
  location.value = "7";
  current = { value: 9 };
  return {
    before,
    after: original.value,
    same,
    stableAfterReplacement: location.value,
    trace,
  };
}

function propertyLocation<
  TObject extends object,
  TKey extends keyof TObject,
>(object: TObject, key: TKey): TestLocation<TObject[TKey]> {
  return {
    storageIdentity: object,
    storageKey: key,
    get value(): TObject[TKey] {
      return object[key];
    },
    set value(value: TObject[TKey]) {
      object[key] = value;
    },
  };
}

function projectedLocation<TSource, TTarget>(
  source: TestLocation<TSource>,
  fromSource: (value: TSource) => TTarget,
  toSource: (value: TTarget) => TSource,
): TestLocation<TTarget> {
  return {
    storageIdentity: source.storageIdentity,
    storageKey: source.storageKey,
    get value(): TTarget {
      return fromSource(source.value);
    },
    set value(value: TTarget) {
      source.value = toSource(value);
    },
  };
}

class TestProjectedPropertyLocation<
  TObject extends object,
  TKey extends keyof TObject,
  TTarget,
> implements TestLocation<TTarget> {
  constructor(
    readonly storageIdentity: TObject,
    readonly storageKey: TKey,
    readonly fromSource: (value: TObject[TKey]) => TTarget,
    readonly toSource: (value: TTarget) => TObject[TKey],
  ) {}

  get value(): TTarget {
    return this.fromSource(this.storageIdentity[this.storageKey]);
  }

  set value(value: TTarget) {
    this.storageIdentity[this.storageKey] = this.toSource(value);
  }
}

function sameTestLocation<T>(
  left: TestLocation<T>,
  right: TestLocation<T>,
): boolean {
  return left.storageIdentity === right.storageIdentity &&
    left.storageKey === right.storageKey;
}
