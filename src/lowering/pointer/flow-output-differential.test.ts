import assert from "node:assert/strict";
import { test } from "node:test";

import {
  createCompilerSessionFromFiles,
  pointerOperationFactKey,
  transpileModule,
} from "@tsonic/tsts";
import type { PointerOperationFact } from "@tsonic/tsts";

import {
  checkedPointerFixture,
  countCallsNamed,
  createFixturePointerFlowPlan,
  variableDeclarationNamed,
  visit,
} from "./pointer.test-support.js";
import { lowerPointers } from "./transform.js";

test("emits exact AST shapes for all selected pointer representations", () => {
  const snapshot = checkedPointerFixture(`
import type { Pointer } from "./markers.js";
import { allocatePointer, loadPointer } from "./markers.js";
const pointer: Pointer<number> = allocatePointer(41);
export const result = loadPointer(pointer) + 1;
`);
  const snapshotPlan = createFixturePointerFlowPlan(snapshot.source);
  const snapshotOutput = lowerPointers(
    snapshot.source,
    snapshot.sourceFile,
    snapshotPlan,
  );
  assertRepresentations(snapshot, snapshotPlan, "direct-snapshot");
  assert.equal(
    snapshot.source.ast.kindName(variableDeclarationNamed(
      snapshot.source,
      snapshotOutput.sourceFile,
      "pointer",
    ).Initializer),
    "KindNumericLiteral",
  );
  assertMarkersRemoved(snapshot, snapshotOutput.sourceFile);

  const mutable = checkedPointerFixture(`
import type { Pointer } from "./markers.js";
import { allocatePointer, loadPointer, storePointer } from "./markers.js";
const pointer: Pointer<number> = allocatePointer(1);
const alias = pointer;
storePointer(alias, 41);
export const result = loadPointer(pointer) + 1;
`);
  const mutablePlan = createFixturePointerFlowPlan(mutable.source);
  const mutableOutput = lowerPointers(
    mutable.source,
    mutable.sourceFile,
    mutablePlan,
  );
  assertRepresentations(mutable, mutablePlan, "mutable-cell");
  assert.equal(
    mutable.source.ast.kindName(variableDeclarationNamed(
      mutable.source,
      mutableOutput.sourceFile,
      "pointer",
    ).Initializer),
    "KindObjectLiteralExpression",
  );
  assertMarkersRemoved(mutable, mutableOutput.sourceFile);

  const directObject = checkedPointerFixture(`
import type { Pointer } from "./markers.js";
import { allocatePointer, loadPointer } from "./markers.js";
class Box { constructor(public value: number) {} }
const pointer: Pointer<Box> = allocatePointer(new Box(41));
export const result = loadPointer(pointer).value + 1;
`);
  const objectPlan = createFixturePointerFlowPlan(directObject.source);
  const objectOutput = lowerPointers(
    directObject.source,
    directObject.sourceFile,
    objectPlan,
  );
  assertRepresentations(directObject, objectPlan, "direct-object");
  assert.equal(
    directObject.source.ast.kindName(variableDeclarationNamed(
      directObject.source,
      objectOutput.sourceFile,
      "pointer",
    ).Initializer),
    "KindNewExpression",
  );
  assertMarkersRemoved(directObject, objectOutput.sourceFile);
});

test("retains hash, provider bind, and projection with exact runtime shapes", () => {
  const fixture = checkedPointerFixture(`
import type { Pointer } from "./markers.js";
import { bindPointer, hashPointer, projectPointer } from "./markers.js";
let value = 1;
const bound: Pointer<number> = bindPointer(
  {},
  () => value,
  next => { value = next; },
);
const projected = projectPointer(
  bound,
  current => String(current),
  Number,
)!;
export const result = hashPointer(projected);
`);
  const plan = createFixturePointerFlowPlan(fixture.source);
  const lowered = lowerPointers(fixture.source, fixture.sourceFile, plan);

  assertRepresentations(fixture, plan, "location");
  const binding = pointerOperations(fixture).find((operation) =>
    operation.operation === "bind-pointer"
  );
  assert.ok(binding !== undefined);
  const component = plan.componentFor(binding.call);
  assert.ok(component !== undefined);
  const reasons = new Set(component.retentionReasons.map((entry) => entry.reason));
  assert.deepEqual(
    [...reasons].sort(),
    ["identity-observed", "projection-observed", "provider-binding"],
  );
  assert.equal(countCallsNamed(fixture.source, lowered.sourceFile, "boundLocation"), 1);
  assert.equal(countCallsNamed(fixture.source, lowered.sourceFile, "projectLocation"), 1);
  assert.equal(countCallsNamed(fixture.source, lowered.sourceFile, "hashLocation"), 1);
  assertMarkersRemoved(fixture, lowered.sourceFile);
});

test("matches canonical pointer behavior in executable strict output shapes", async () => {
  const pairs = [
    [canonicalSnapshot, directSnapshot],
    [canonicalMutable, directMutable],
    [canonicalObject, directObject],
    [canonicalProviderProjection, loweredProviderProjection],
  ] as const;
  for (let index = 0; index < pairs.length; index += 1) {
    const pair = pairs[index];
    assert.ok(pair !== undefined);
    const [canonical, lowered] = await Promise.all([
      executeStrictTypeScript(pair[0], `pointer-canonical-${index}`),
      executeStrictTypeScript(pair[1], `pointer-lowered-${index}`),
    ]);
    assert.deepEqual(lowered["result"], canonical["result"]);
  }
});

function assertRepresentations(
  fixture: ReturnType<typeof checkedPointerFixture>,
  plan: ReturnType<typeof createFixturePointerFlowPlan>,
  expected: ReturnType<typeof plan.representationFor>,
): void {
  const operations = pointerOperations(fixture);
  assert.ok(operations.length > 0);
  for (const operation of operations) {
    assert.equal(plan.representationFor(operation.call), expected);
  }
}

function assertMarkersRemoved(
  fixture: ReturnType<typeof checkedPointerFixture>,
  sourceFile: Parameters<typeof countCallsNamed>[1],
): void {
  for (const marker of [
    "allocatePointer",
    "loadPointer",
    "storePointer",
    "bindPointer",
    "projectPointer",
    "hashPointer",
  ]) {
    assert.equal(countCallsNamed(fixture.source, sourceFile, marker), 0, marker);
  }
}

function pointerOperations(
  fixture: ReturnType<typeof checkedPointerFixture>,
): readonly PointerOperationFact[] {
  const operations = new Map<object, PointerOperationFact>();
  visit(fixture.source, fixture.sourceFile, (node) => {
    const operation = fixture.source.sourceFacts.getFact(
      node,
      pointerOperationFactKey,
    );
    if (operation !== undefined) {
      operations.set(operation.call, operation);
    }
  });
  return Object.freeze([...operations.values()]);
}

async function executeStrictTypeScript(
  sourceText: string,
  identity: string,
): Promise<Readonly<Record<string, unknown>>> {
  const fileName = `/src/${identity}.ts`;
  const session = createCompilerSessionFromFiles({
    currentDirectory: "/src",
    files: { [fileName]: sourceText },
    rootFiles: [fileName],
    compilerOptions: {
      module: "esnext",
      moduleResolution: "bundler",
      strict: true,
      target: "es2022",
    },
  });
  const checked = session.checkSource();
  assert.deepEqual(checked.diagnostics, []);
  assert.deepEqual(checked.extensionDiagnostics, []);
  const transpiled = transpileModule(sourceText, {
    fileName,
    reportDiagnostics: true,
    compilerOptions: { module: "esnext", target: "es2022" },
  });
  assert.deepEqual(transpiled.diagnostics, []);
  const encoded = Buffer.from(transpiled.outputText, "utf8").toString("base64");
  return import(`data:text/javascript;base64,${encoded}#${identity}`) as
    Promise<Readonly<Record<string, unknown>>>;
}

const canonicalSnapshot = `class Pointer<T> { constructor(public value: T) {} }
const pointer = new Pointer(41);
export const result = pointer.value + 1;
`;
const directSnapshot = `const pointer = 41;
export const result = pointer + 1;
`;
const canonicalMutable = `class Pointer<T> { constructor(public value: T) {} }
const pointer = new Pointer(1);
const alias = pointer;
alias.value = 41;
export const result = pointer.value + 1;
`;
const directMutable = `const pointer = { value: 1 };
const alias = pointer;
alias.value = 41;
export const result = pointer.value + 1;
`;
const canonicalObject = `class Pointer<T> { constructor(public value: T) {} }
class Box { constructor(public value: number) {} }
const pointer = new Pointer(new Box(41));
export const result = pointer.value.value + 1;
`;
const directObject = `class Box { constructor(public value: number) {} }
const pointer = new Box(41);
export const result = pointer.value + 1;
`;
const canonicalProviderProjection = providerProjection("Pointer", "bindPointer", "projectPointer", "hashPointer");
const loweredProviderProjection = providerProjection("Location", "boundLocation", "projectLocation", "hashLocation");

function providerProjection(
  typeName: string,
  bindName: string,
  projectName: string,
  hashName: string,
): string {
  return `interface ${typeName}<T> { value: T }
const hashes = new WeakMap<object, number>();
let nextHash = 1;
function ${bindName}<T>(identity: object, read: () => T, write: (value: T) => void): ${typeName}<T> {
  void identity;
  return { get value() { return read(); }, set value(value: T) { write(value); } };
}
function ${projectName}<F, T>(source: ${typeName}<F>, read: (value: F) => T, write: (value: T) => F): ${typeName}<T> {
  return ${bindName}(source, () => read(source.value), value => { source.value = write(value); });
}
function ${hashName}<T>(pointer: ${typeName}<T>): number {
  let hash = hashes.get(pointer);
  if (hash === undefined) { hash = nextHash++; hashes.set(pointer, hash); }
  return hash;
}
let value = 1;
const bound = ${bindName}({}, () => value, next => { value = next; });
const projected = ${projectName}(bound, String, Number);
const before = ${hashName}(projected);
projected.value = "7";
export const result = [value, before === ${hashName}(projected)];
`;
}
