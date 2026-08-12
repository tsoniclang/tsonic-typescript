import assert from "node:assert/strict";
import { test } from "node:test";

import { pointerOperationFactKey, transpileModule } from "@tsonic/tsts";
import type { Node, PointerOperationFact } from "@tsonic/tsts";
import {
  AsBinaryExpression,
  IsObjectLiteralExpression,
  KindEqualsEqualsEqualsToken,
} from "@tsonic/tsts/target-ast";
import type { TargetSourceProgram } from "@tsonic/target-api";

import {
  checkedPointerFixture,
  countCallsNamed,
  createFixturePointerFlowPlan,
  variableDeclarationNamed,
  visit,
} from "./pointer.test-support.js";
import { lowerPointers } from "./transform.js";

test("uses one exact mutable cell for a replaceable object family", () => {
  const fixture = checkedPointerFixture(`import type { Pointer } from "./markers.js";
import { allocatePointer, loadPointer, storePointer } from "./markers.js";
class Box { constructor(public value: number) {} }
function replace(pointer: Pointer<Box>, value: Box): void {
  storePointer(pointer, value);
}
function read(pointer: Pointer<Box>): number {
  return loadPointer(pointer).value;
}
const pointer: Pointer<Box> = allocatePointer(new Box(1));
const alias = pointer;
replace(alias, new Box(2));
export const result = read(pointer);
`);
  const plan = createFixturePointerFlowPlan(fixture.source);

  assert.equal(plan.optimizedFamilyCount, 1);
  assertRepresentations(fixture.source, plan, "mutable-cell");
  assert.equal(
    plan.familyFallbackReasons.some((entry) =>
      entry.reason === "pointee-replacement"
    ),
    false,
  );

  const lowered = lowerPointers(fixture.source, fixture.sourceFile, plan);
  const pointer = variableDeclarationNamed(
    fixture.source,
    lowered.sourceFile,
    "pointer",
  );
  assert.equal(lowered.runtimeAlias, undefined);
  assert.equal(fixture.source.ast.kindName(pointer.Type), "KindTypeLiteral");
  assert.equal(
    countNodes(fixture.source, pointer.Initializer, IsObjectLiteralExpression),
    1,
  );
  for (const marker of ["allocatePointer", "loadPointer", "storePointer"]) {
    assert.equal(countCallsNamed(fixture.source, lowered.sourceFile, marker), 0);
  }
});

test("preserves pointer identity when mutable cells share a pointee", () => {
  const fixture = checkedPointerFixture(`import type { Pointer } from "./markers.js";
import { allocatePointer, equalPointer, hashPointer, loadPointer, storePointer } from "./markers.js";
class Box { constructor(public value: number) {} }
const shared = new Box(1);
const left: Pointer<Box> = allocatePointer(shared);
const alias = left;
const right: Pointer<Box> = allocatePointer(shared);
storePointer(left, new Box(2));
export const same = equalPointer(left, right);
export const hashes = [
  hashPointer(left) === hashPointer(alias),
  hashPointer(left) === hashPointer(right),
];
export const result = loadPointer(left).value;
`);
  const plan = createFixturePointerFlowPlan(fixture.source);

  assertRepresentations(fixture.source, plan, "mutable-cell");
  const lowered = lowerPointers(fixture.source, fixture.sourceFile, plan);
  const same = variableDeclarationNamed(
    fixture.source,
    lowered.sourceFile,
    "same",
  );
  const equality = AsBinaryExpression(same.Initializer);
  assert.equal(equality?.OperatorToken?.Kind, KindEqualsEqualsEqualsToken);
  assert.equal(fixture.source.ast.text(equality?.Left), "left");
  assert.equal(fixture.source.ast.text(equality?.Right), "right");
  assert.ok(lowered.runtimeAlias !== undefined);
  assert.equal(countCallsNamed(fixture.source, lowered.sourceFile, "hashPointer"), 0);
  assert.equal(countCallsNamed(fixture.source, lowered.sourceFile, "rawPointer"), 4);
  assert.equal(countCallsNamed(fixture.source, lowered.sourceFile, "hashRawPointer"), 4);
});

test("keeps one mutable representation across disconnected family flows", () => {
  const fixture = checkedPointerFixture(`import type { Pointer } from "./markers.js";
import { allocatePointer, loadPointer, storePointer } from "./markers.js";
class Box { constructor(public value: number) {} }
const mutable: Pointer<Box> = allocatePointer(new Box(1));
storePointer(mutable, new Box(2));
const readonly: Pointer<Box> = allocatePointer(new Box(3));
export const result = loadPointer(readonly).value;
`);
  const plan = createFixturePointerFlowPlan(fixture.source);

  assert.equal(plan.optimizedFamilyCount, 1);
  assertRepresentations(fixture.source, plan, "mutable-cell");
});

test("does not detach an addressed object from its source storage", () => {
  const fixture = checkedPointerFixture(`import type { Pointer } from "./markers.js";
import { addressOf, allocatePointer, loadPointer, storePointer } from "./markers.js";
class Box { constructor(public value: number) {} }
let box = new Box(1);
const addressed: Pointer<Box> = addressOf(box);
const allocated: Pointer<Box> = allocatePointer(new Box(2));
storePointer(allocated, new Box(3));
export const result = loadPointer(addressed).value + loadPointer(allocated).value;
`);
  const plan = createFixturePointerFlowPlan(fixture.source);

  assert.equal(plan.optimizedFamilyCount, 0);
  assert.ok(plan.familyFallbackReasons.some((entry) =>
    entry.reason === "pointee-replacement"
  ));
  const operations = pointerOperations(fixture.source);
  const address = operations.find((operation) =>
    operation.operation === "address-of"
  );
  const store = operations.find((operation) => operation.operation === "store");
  assert.ok(address !== undefined);
  assert.ok(store !== undefined);
  assert.equal(plan.representationFor(address.call), "direct-object");
  assert.equal(plan.representationFor(store.call), "mutable-cell");
  assert.doesNotThrow(() =>
    lowerPointers(fixture.source, fixture.sourceFile, plan)
  );
});

test("keeps replaceable object cells canonical across an ambient boundary", () => {
  const fixture = checkedPointerFixture(`import type { Pointer } from "./markers.js";
import { allocatePointer, loadPointer, storePointer } from "./markers.js";
import { observe } from "./external.js";
export class Box { constructor(public value: number) {} }
const pointer: Pointer<Box> = allocatePointer(new Box(1));
storePointer(pointer, new Box(2));
observe(pointer);
export const result = loadPointer(pointer).value;
`, {
    "/src/external.d.ts": `import type { Pointer } from "./markers.js";
import type { Box } from "./index.js";
export declare function observe(pointer: Pointer<Box>): void;
`,
  });
  const plan = createFixturePointerFlowPlan(fixture.source);

  assertRepresentations(fixture.source, plan, "location");
  assert.ok(plan.familyFallbackReasons.some((entry) =>
    entry.reason === "external-boundary"
  ));
});

test("matches canonical location behavior for aliasing and replacement", async () => {
  const canonical = `class Location<T> {
  constructor(public value: T) {}
}
class Box { constructor(public value: number) {} }
const shared = new Box(1);
const left = new Location(shared);
const alias = left;
const right = new Location(shared);
left.value = new Box(2);
export const result = [left.value.value, left === alias, left === right];
`;
  const lowered = `class Box { constructor(public value: number) {} }
const shared = new Box(1);
const left = { value: shared };
const alias = left;
const right = { value: shared };
void (left.value = new Box(2));
export const result = [left.value.value, left === alias, left === right];
`;

  const [canonicalModule, loweredModule] = await Promise.all([
    executeTypeScript(canonical, "canonical-mutable-object-pointer"),
    executeTypeScript(lowered, "lowered-mutable-object-pointer"),
  ]);
  assert.deepEqual(canonicalModule["result"], [2, true, false]);
  assert.deepEqual(loweredModule["result"], canonicalModule["result"]);
});

function assertRepresentations(
  source: TargetSourceProgram,
  plan: ReturnType<typeof createFixturePointerFlowPlan>,
  expected: "location" | "mutable-cell",
): void {
  const operations = pointerOperations(source);
  assert.ok(operations.length > 0);
  for (const operation of operations) {
    assert.equal(
      plan.representationFor(operation.call),
      expected,
      operation.operation,
    );
  }
}

function pointerOperations(
  source: TargetSourceProgram,
): readonly PointerOperationFact[] {
  const operations: PointerOperationFact[] = [];
  for (const sourceFile of source.navigation.sourceFiles) {
    visit(source, sourceFile, (node) => {
      const operation = source.sourceFacts.getFact(
        node,
        pointerOperationFactKey,
      );
      if (operation !== undefined) {
        operations.push(operation);
      }
    });
  }
  return operations;
}

function countNodes(
  source: TargetSourceProgram,
  root: Node | undefined,
  predicate: (node: Node | undefined) => boolean,
): number {
  if (root === undefined) {
    return 0;
  }
  let count = 0;
  visit(source, root, (node) => {
    if (predicate(node)) {
      count += 1;
    }
  });
  return count;
}

async function executeTypeScript(
  sourceText: string,
  identity: string,
): Promise<Readonly<Record<string, unknown>>> {
  const transpiled = transpileModule(sourceText, {
    fileName: `${identity}.ts`,
    reportDiagnostics: true,
    compilerOptions: {
      module: "esnext",
      target: "es2022",
    },
  });
  assert.equal(transpiled.diagnostics.length, 0);
  const encoded = Buffer.from(transpiled.outputText, "utf8").toString("base64");
  return import(`data:text/javascript;base64,${encoded}#${identity}`) as
    Promise<Readonly<Record<string, unknown>>>;
}
