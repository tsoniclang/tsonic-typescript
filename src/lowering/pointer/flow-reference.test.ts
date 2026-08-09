import assert from "node:assert/strict";
import { test } from "node:test";

import { pointerOperationFactKey } from "@tsonic/tsts";
import type { Node, PointerOperationFact } from "@tsonic/tsts";
import type { TargetSourceProgram } from "@tsonic/target-api";

import {
  createClosedPointerFlowPlan,
  type PointerFlowRepresentation,
} from "./flow-plan.js";
import {
  checkedPointerFixture,
  visit,
} from "./pointer.test-support.js";

test("keeps a pointer binding canonical when object shorthand observes it", () => {
  const fixture = checkedPointerFixture(`import type { Pointer } from "./markers.js";
import { allocatePointer, loadPointer } from "./markers.js";
const pointer: Pointer<number> = allocatePointer(1);
export const escaped = { pointer };
export const result = loadPointer(pointer);
`);

  assertAllOperations(fixture.source, "location");
});

test("treats an export specifier as a transparent closed-module alias", () => {
  const fixture = checkedPointerFixture(`import type { Pointer } from "./markers.js";
import { allocatePointer, loadPointer } from "./markers.js";
const pointer: Pointer<number> = allocatePointer(1);
export { pointer };
export const result = loadPointer(pointer);
`);

  assertAllOperations(fixture.source, "direct-snapshot");
});

test("keeps a pointer function canonical when shorthand observes it", () => {
  const fixture = checkedPointerFixture(`import type { Pointer } from "./markers.js";
import { allocatePointer, loadPointer } from "./markers.js";
function read(pointer: Pointer<number>): number { return loadPointer(pointer); }
const handlers = { read };
const pointer = allocatePointer(1);
handlers.read(pointer);
export const result = read(pointer);
`);

  assertAllOperations(fixture.source, "location");
});

test("tracks exact symbols without conflating a shadowed spelling", () => {
  const fixture = checkedPointerFixture(`import type { Pointer } from "./markers.js";
import { allocatePointer, loadPointer } from "./markers.js";
const pointer: Pointer<number> = allocatePointer(1);
function unrelated(): number { const pointer = 40; return pointer + 1; }
export const result = loadPointer(pointer) + unrelated();
`);

  assertAllOperations(fixture.source, "direct-snapshot");
});

test("uses exact write evidence to reject pointer rebinding", () => {
  const fixture = checkedPointerFixture(`import type { Pointer } from "./markers.js";
import { allocatePointer, loadPointer } from "./markers.js";
let pointer: Pointer<number> = allocatePointer(1);
pointer = allocatePointer(2);
export const result = loadPointer(pointer);
`);

  assertAllOperations(fixture.source, "location");
  const plan = createClosedPointerFlowPlan(fixture.source);
  assert.ok(plan.components.some((component) =>
    component.blockers.includes("pointer-rebinding")
  ));
});

test("does not perform source-reference lookup per unrelated identifier", () => {
  const unrelated = Array.from(
    { length: 256 },
    (_, index) => `const unrelated${index} = ${index};`,
  ).join("\n");
  const fixture = checkedPointerFixture(`import type { Pointer } from "./markers.js";
import { allocatePointer, loadPointer } from "./markers.js";
${unrelated}
const pointer: Pointer<number> = allocatePointer(1);
export const result = loadPointer(pointer);
`);
  let sourceReferenceQueries = 0;
  const source: TargetSourceProgram = Object.freeze({
    ...fixture.source,
    navigation: Object.freeze({
      ...fixture.source.navigation,
      sourceReferenceFor(node: Node | undefined) {
        sourceReferenceQueries += 1;
        return fixture.source.navigation.sourceReferenceFor(node);
      },
    }),
  });

  assertAllOperations(source, "direct-snapshot");
  assert.ok(
    sourceReferenceQueries < 16,
    `expected bounded exact-reference queries, got ${sourceReferenceQueries}`,
  );
});

test("closes nullable pointer flow through an exact static method call", () => {
  const fixture = checkedPointerFixture(`import type { Pointer } from "./markers.js";
import { allocatePointer, loadPointer } from "./markers.js";
function panic(): never { throw new Error("nil"); }
export class Reader {
  static read(pointer: Pointer<number> | undefined): number {
    return loadPointer(pointer ?? panic());
  }
}
const pointer: Pointer<number> | undefined = allocatePointer(41);
export const result = Reader.read(pointer) + 1;
`);

  assertAllOperations(fixture.source, "direct-snapshot");
});

test("closes an exact pointer call across project modules", () => {
  const fixture = checkedPointerFixture(
    `import type { Pointer } from "./markers.js";
import { allocatePointer } from "./markers.js";
import { read } from "./read.js";
const pointer: Pointer<number> | undefined = allocatePointer(41);
export const result = read(pointer) + 1;
`,
    {
      "/src/read.ts": `import type { Pointer } from "./markers.js";
import { loadPointer } from "./markers.js";
function panic(): never { throw new Error("nil"); }
export function read(pointer: Pointer<number> | undefined): number {
  return loadPointer(pointer ?? panic());
}
`,
    },
  );

  assertAllOperations(fixture.source, "direct-snapshot");
});

function assertAllOperations(
  source: TargetSourceProgram,
  expected: PointerFlowRepresentation,
): void {
  const plan = createClosedPointerFlowPlan(source);
  const operations = pointerOperations(source);
  assert.ok(operations.length > 0);
  for (const operation of operations) {
    assert.equal(plan.representationFor(operation.call), expected);
  }
}

function pointerOperations(
  source: TargetSourceProgram,
): readonly PointerOperationFact[] {
  const result: PointerOperationFact[] = [];
  for (const sourceFile of source.navigation.sourceFiles) {
    visit(source, sourceFile, (node) => {
      const operation = source.sourceFacts.getFact(node, pointerOperationFactKey);
      if (operation !== undefined) {
        result.push(operation);
      }
    });
  }
  return result;
}
