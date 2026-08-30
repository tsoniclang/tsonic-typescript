import assert from "node:assert/strict";
import { test } from "node:test";

import { pointerOperationFactKey } from "@tsonic/tsts";

import {
  checkedPointerFixture,
  countCallsNamed,
  createFixturePointerFlowPlan,
  visit,
} from "./pointer.test-support.js";
import { lowerPointers } from "./transform.js";

test("uses fresh addressed factory values for pointer identity", () => {
  const fixture = checkedPointerFixture(`import type { Pointer } from "./markers.js";
import { addressOf, equalPointer, hashPointer, loadPointer, storePointer } from "./markers.js";
class Box {
  declare private readonly $goType: void;
  constructor(public value: number) {}
  declare private readonly then?: never;
}
function fresh(value: number): Box { return new Box(value); }
function reset(pointer: Pointer<Box>, value: number): void {
  storePointer(pointer, fresh(value));
}
let first = fresh(1);
let second = fresh(2);
const left: Pointer<Box> = addressOf(first);
const alias = left;
const right: Pointer<Box> = addressOf(second);
reset(alias, 3);
export const result = [
  loadPointer(left).value,
  equalPointer(left, alias),
  equalPointer(left, right),
  hashPointer(left) === hashPointer(alias),
];
`);
  const plan = createFixturePointerFlowPlan(fixture.source);

  assert.equal(plan.optimizedFamilyCount, 1);
  assert.equal(plan.directObjectReplacementCount, 1);
  assert.equal(plan.retainedFamilyCount, 0);
  for (const sourceFile of fixture.source.navigation.sourceFiles) {
    visit(fixture.source, sourceFile, (node) => {
      const operation = fixture.source.sourceFacts.getFact(
        node,
        pointerOperationFactKey,
      );
      if (operation !== undefined) {
        assert.equal(plan.representationFor(operation.call), "direct-object");
      }
    });
  }

  const lowered = lowerPointers(fixture.source, fixture.sourceFile, plan);
  for (const marker of [
    "addressOf",
    "equalPointer",
    "hashPointer",
    "loadPointer",
    "storePointer",
  ]) {
    assert.equal(countCallsNamed(fixture.source, lowered.sourceFile, marker), 0);
  }
  assert.equal(countCallsNamed(
    fixture.source,
    lowered.sourceFile,
    "$tsonicReplace",
  ), 1);
});

test("admits whole-object replacement with a canonical structure assertion", () => {
  const fixture = checkedPointerFixture(`import type { Pointer } from "./markers.js";
import { addressOf, field, storePointer, struct } from "./markers.js";
class Box {
  constructor(public value: number) {
    struct({ value: field<number>() });
  }
}
let box = new Box(1);
const pointer: Pointer<Box> = addressOf(box);
storePointer(pointer, new Box(2));
export const result = box.value;
`);
  const plan = createFixturePointerFlowPlan(fixture.source);

  assert.equal(plan.optimizedFamilyCount, 1);
  assert.equal(plan.directObjectReplacementCount, 1);
  assert.equal(plan.retainedFamilyCount, 0);
});

test("uses exact stable value-structure fields for pointer identity", () => {
  const fixture = checkedPointerFixture(`import type { Pointer } from "./markers.js";
import { addressOf, equalPointer, field, loadPointer, struct } from "./markers.js";
class Type {
  declare private readonly $goType: void;
  constructor(public flags: number) {
    struct({ flags: field<number>() });
  }
}
class Base {
  declare private readonly $goType: void;
  constructor(public Type: Type) {
    struct({ Type: field<Type>() });
  }
}
const first = new Base(new Type(1));
const second = new Base(new Type(1));
const left: Pointer<Type> = addressOf(first.Type);
const alias = left;
const right: Pointer<Type> = addressOf(second.Type);
export const result = [
  loadPointer(left).flags,
  equalPointer(left, alias),
  equalPointer(left, right),
];
`);
  const plan = createFixturePointerFlowPlan(fixture.source);

  assert.equal(plan.optimizedFamilyCount, 1);
  assert.equal(plan.retainedFamilyCount, 0);
  for (const sourceFile of fixture.source.navigation.sourceFiles) {
    visit(fixture.source, sourceFile, (node) => {
      const operation = fixture.source.sourceFacts.getFact(
        node,
        pointerOperationFactKey,
      );
      if (operation !== undefined) {
        assert.equal(plan.representationFor(operation.call), "direct-object");
      }
    });
  }
});

test("retains a value-structure field whose represented object is shared", () => {
  const fixture = checkedPointerFixture(`import type { Pointer } from "./markers.js";
import { addressOf, equalPointer, field, struct } from "./markers.js";
class Type {
  constructor(public flags: number) {
    struct({ flags: field<number>() });
  }
}
class Base {
  constructor(public Type: Type) {
    struct({ Type: field<Type>() });
  }
}
const shared = new Type(1);
const first = new Base(shared);
const second = new Base(shared);
const left: Pointer<Type> = addressOf(first.Type);
const right: Pointer<Type> = addressOf(second.Type);
export const same = equalPointer(left, right);
`);
  const plan = createFixturePointerFlowPlan(fixture.source);

  assert.equal(plan.optimizedFamilyCount, 0);
  assert.equal(plan.retainedFamilyCount, 1);
  assert.equal(
    plan.familyFallbackReasons.find((entry) =>
      entry.reason === "non-bijective-identity"
    )?.count,
    1,
  );
});

test("retains value-structure field identity after an owner write", () => {
  const fixture = checkedPointerFixture(`import type { Pointer } from "./markers.js";
import { addressOf, equalPointer, field, struct } from "./markers.js";
class Type {
  constructor(public flags: number) {
    struct({ flags: field<number>() });
  }
}
class Base {
  constructor(public Type: Type) {
    struct({ Type: field<Type>() });
  }
}
let first = new Base(new Type(1));
const left: Pointer<Type> = addressOf(first.Type);
first = new Base(new Type(2));
const right: Pointer<Type> = addressOf(first.Type);
export const same = equalPointer(left, right);
`);
  const plan = createFixturePointerFlowPlan(fixture.source);

  assert.equal(plan.optimizedFamilyCount, 0);
  assert.equal(plan.retainedFamilyCount, 1);
});

test("retains value-structure field identity after a field write", () => {
  const fixture = checkedPointerFixture(`import type { Pointer } from "./markers.js";
import { addressOf, equalPointer, field, struct } from "./markers.js";
class Type {
  constructor(public flags: number) {
    struct({ flags: field<number>() });
  }
}
class Base {
  constructor(public Type: Type) {
    struct({ Type: field<Type>() });
  }
}
const first = new Base(new Type(1));
const left: Pointer<Type> = addressOf(first.Type);
first.Type = new Type(2);
const right: Pointer<Type> = addressOf(first.Type);
export const same = equalPointer(left, right);
`);
  const plan = createFixturePointerFlowPlan(fixture.source);

  assert.equal(plan.optimizedFamilyCount, 0);
  assert.equal(plan.retainedFamilyCount, 1);
});

test("retains value-structure fields when the marker layout disagrees", () => {
  const fixture = checkedPointerFixture(`import type { Pointer } from "./markers.js";
import { addressOf, equalPointer, field, struct } from "./markers.js";
class Type {
  constructor(public flags: number) {
    struct({ flags: field<number>() });
  }
}
class Base {
  constructor(public Type: Type) {
    struct({ Other: field<Type>() });
  }
}
const first = new Base(new Type(1));
const second = new Base(new Type(2));
const left: Pointer<Type> = addressOf(first.Type);
const right: Pointer<Type> = addressOf(second.Type);
export const same = equalPointer(left, right);
`);
  const plan = createFixturePointerFlowPlan(fixture.source);

  assert.equal(plan.optimizedFamilyCount, 0);
  assert.equal(plan.retainedFamilyCount, 1);
});

test("retains addressed fields without canonical value-structure evidence", () => {
  const fixture = checkedPointerFixture(`import type { Pointer } from "./markers.js";
import { addressOf, equalPointer } from "./markers.js";
class Type { constructor(public flags: number) {} }
class Base { constructor(public Type: Type) {} }
const first = new Base(new Type(1));
const second = new Base(new Type(2));
const left: Pointer<Type> = addressOf(first.Type);
const right: Pointer<Type> = addressOf(second.Type);
export const same = equalPointer(left, right);
`);
  const plan = createFixturePointerFlowPlan(fixture.source);

  assert.equal(plan.optimizedFamilyCount, 0);
  assert.equal(plan.retainedFamilyCount, 1);
});

test("retains addressed aliases that share one object identity", () => {
  const fixture = checkedPointerFixture(`import type { Pointer } from "./markers.js";
import { addressOf, equalPointer } from "./markers.js";
class Box { constructor(public value: number) {} }
const shared = new Box(1);
let first = shared;
let second = shared;
const left: Pointer<Box> = addressOf(first);
const right: Pointer<Box> = addressOf(second);
export const same = equalPointer(left, right);
`);
  const plan = createFixturePointerFlowPlan(fixture.source);

  assert.equal(plan.optimizedFamilyCount, 0);
  assert.equal(plan.retainedFamilyCount, 1);
  assert.equal(
    plan.familyFallbackReasons.find((entry) =>
      entry.reason === "non-bijective-identity"
    )?.count,
    1,
  );
});

test("rejects a free factory that returns shared state", () => {
  const fixture = checkedPointerFixture(`import type { Pointer } from "./markers.js";
import { addressOf, equalPointer } from "./markers.js";
class Box { constructor(public value: number) {} }
const shared = new Box(1);
function sharedBox(): Box { return shared; }
let first = sharedBox();
let second = sharedBox();
const left: Pointer<Box> = addressOf(first);
const right: Pointer<Box> = addressOf(second);
export const same = equalPointer(left, right);
`);
  const plan = createFixturePointerFlowPlan(fixture.source);

  assert.equal(plan.optimizedFamilyCount, 0);
  assert.equal(plan.retainedFamilyCount, 1);
  assert.equal(
    plan.familyFallbackReasons.find((entry) =>
      entry.reason === "non-bijective-identity"
    )?.count,
    1,
  );
});
