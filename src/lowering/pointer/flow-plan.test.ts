import assert from "node:assert/strict";
import { test } from "node:test";

import {
  pointerOperationFactKey,
} from "@tsonic/tsts";
import type { Node, PointerOperationFact } from "@tsonic/tsts";
import {
  AsParameterDeclaration,
  AsTypeReferenceNode,
  IsFunctionDeclaration,
  IsObjectLiteralExpression,
  IsPropertyAccessExpression,
  IsParenthesizedExpression,
  NewParenthesizedExpression,
  transformTargetSourceFile,
} from "@tsonic/tsts/target-ast";
import type { TargetSourceProgram } from "@tsonic/target-api";

import { createFinalNodeJournal } from "../final-nodes.js";

import {
  checkedPointerFixture,
  checkedPointerFixtureWithValueSemantics,
  countCallsNamed,
  createFixturePointerFlowPlan as createClosedPointerFlowPlan,
  importModules,
  variableDeclarationNamed,
  visit,
} from "./pointer.test-support.js";
import { createPointerRewriteSession, lowerPointers } from "./transform.js";

test("contracts one closed readonly scalar parameter flow", () => {
  const fixture = checkedPointerFixture(`import type { Pointer } from "./markers.js";
import { allocatePointer, loadPointer } from "./markers.js";

function read(pointer: Pointer<number>): number {
  return loadPointer(pointer);
}
const pointer: Pointer<number> = allocatePointer<number>(41);
export const result = read(pointer) + 1;
`);
  const plan = createClosedPointerFlowPlan(fixture.source);

  assertRepresentations(fixture.source, plan, {
    allocate: "direct-snapshot",
    load: "direct-snapshot",
  });
  assert.equal(plan.optimizedComponentCount, 1);
});

test("uses one mutable cell for an aliased closed scalar flow", () => {
  const fixture = checkedPointerFixture(`import type { Pointer } from "./markers.js";
import { allocatePointer, loadPointer, storePointer } from "./markers.js";

const pointer: Pointer<number> = allocatePointer<number>(1);
const alias = pointer;
storePointer(alias, 2);
export const result = loadPointer(pointer);
`);
  const plan = createClosedPointerFlowPlan(fixture.source);

  assertRepresentations(fixture.source, plan, {
    allocate: "mutable-cell",
    store: "mutable-cell",
    load: "mutable-cell",
  });
});

test("uses the pointee object directly for a closed object flow", () => {
  const fixture = checkedPointerFixture(`import type { Pointer } from "./markers.js";
import { allocatePointer, loadPointer } from "./markers.js";

class Box { value = 1; }
const pointer: Pointer<Box> = allocatePointer<Box>(new Box());
export const result = loadPointer(pointer).value;
`);
  const plan = createClosedPointerFlowPlan(fixture.source);

  assertRepresentations(fixture.source, plan, {
    allocate: "direct-object",
    load: "direct-object",
  });
});

test("emits a closed readonly flow as ordinary scalar TypeScript", () => {
  const fixture = checkedPointerFixture(`import type { Pointer } from "./markers.js";
import { allocatePointer, loadPointer } from "./markers.js";
function read(pointer: Pointer<number>): number { return loadPointer(pointer); }
const pointer: Pointer<number> = allocatePointer(41);
export const result = read(pointer) + 1;
`);
  const plan = createClosedPointerFlowPlan(fixture.source);
  const result = lowerPointers(fixture.source, fixture.sourceFile, plan);
  const read = findNode(fixture.source, result.sourceFile, (node) =>
    IsFunctionDeclaration(node) && fixture.source.ast.text(
      fixture.source.ast.name(node),
    ) === "read"
  );
  const parameter = AsParameterDeclaration(fixture.source.ast.parameters(read)[0]);

  assert.equal(result.runtimeAlias, undefined);
  assert.deepEqual(importModules(fixture.source, result.sourceFile), []);
  assert.equal(countCallsNamed(fixture.source, result.sourceFile, "allocatePointer"), 0);
  assert.equal(countCallsNamed(fixture.source, result.sourceFile, "loadPointer"), 0);
  assert.equal(fixture.source.ast.kindName(parameter?.Type), "KindNumberKeyword");
});

test("emits alias-preserving mutation as one minimal scalar cell", () => {
  const fixture = checkedPointerFixture(`import type { Pointer } from "./markers.js";
import { allocatePointer, loadPointer, storePointer } from "./markers.js";
const pointer: Pointer<number> = allocatePointer(1);
const alias = pointer;
storePointer(alias, 2);
export const result = loadPointer(pointer);
`);
  const plan = createClosedPointerFlowPlan(fixture.source);
  const result = lowerPointers(fixture.source, fixture.sourceFile, plan);
  const pointer = variableDeclarationNamed(
    fixture.source,
    result.sourceFile,
    "pointer",
  );

  assert.equal(result.runtimeAlias, undefined);
  assert.equal(fixture.source.ast.kindName(pointer.Type), "KindTypeLiteral");
  assert.equal(countNodes(fixture.source, result.sourceFile, IsObjectLiteralExpression), 1);
  assert.equal(countNodes(fixture.source, result.sourceFile, IsPropertyAccessExpression), 2);
});

test("emits a closed object flow as the object reference itself", () => {
  const fixture = checkedPointerFixture(`import type { Pointer } from "./markers.js";
import { allocatePointer, loadPointer } from "./markers.js";
class Box { value = 1; }
const pointer: Pointer<Box> = allocatePointer<Box>(new Box());
export const result = loadPointer(pointer).value;
`);
  const plan = createClosedPointerFlowPlan(fixture.source);
  const result = lowerPointers(fixture.source, fixture.sourceFile, plan);
  const pointer = variableDeclarationNamed(
    fixture.source,
    result.sourceFile,
    "pointer",
  );

  assert.equal(result.runtimeAlias, undefined);
  assert.equal(
    fixture.source.ast.text(AsTypeReferenceNode(pointer.Type)?.TypeName),
    "Box",
  );
  assert.equal(countCallsNamed(fixture.source, result.sourceFile, "allocatePointer"), 0);
  assert.equal(countCallsNamed(fixture.source, result.sourceFile, "loadPointer"), 0);
});

test("falls back for identity-observed and potentially nil flows", () => {
  const fixtures = [
    checkedPointerFixture(`import type { Pointer } from "./markers.js";
import { allocatePointer, hashPointer } from "./markers.js";
const pointer: Pointer<number> = allocatePointer(1);
export const result = hashPointer(pointer);
`),
    checkedPointerFixture(`import type { Pointer } from "./markers.js";
import { allocatePointer, equalPointer } from "./markers.js";
const left: Pointer<number> = allocatePointer(1);
const right: Pointer<number> = allocatePointer(1);
export const result = equalPointer(left, right);
`),
    checkedPointerFixture(`import type { Pointer } from "./markers.js";
import { allocatePointer, loadPointer } from "./markers.js";
const pointer: Pointer<number> | undefined = Math.random() > 0.5
  ? allocatePointer(1)
  : undefined;
export const result = loadPointer(pointer!);
`),
  ];

  for (const [fixtureIndex, fixture] of fixtures.entries()) {
    const plan = createClosedPointerFlowPlan(fixture.source);
    for (const operation of pointerOperations(fixture.source)) {
      assert.equal(
        plan.representationFor(operation.call),
        "location",
        `fallback fixture ${fixtureIndex}`,
      );
    }
  }
});

test("treats project exports as closed only in the explicit closed plan", () => {
  const fixture = checkedPointerFixture(`import type { Pointer } from "./markers.js";
import { allocatePointer, loadPointer } from "./markers.js";
export const pointer: Pointer<number> = allocatePointer(1);
export const result = loadPointer(pointer);
`);

  assertRepresentations(fixture.source, createClosedPointerFlowPlan(fixture.source), {
    allocate: "direct-snapshot",
    load: "direct-snapshot",
  });
  const canonical = lowerPointers(fixture.source, fixture.sourceFile);
  assert.ok(canonical.runtimeAlias !== undefined);
});

test("keeps disconnected flow decisions independent", () => {
  const fixture = checkedPointerFixture(`import type { Pointer } from "./markers.js";
import { allocatePointer, hashPointer, loadPointer } from "./markers.js";
const direct: Pointer<number> = allocatePointer(1);
const observed: Pointer<number> = allocatePointer(2);
export const result = loadPointer(direct) + hashPointer(observed);
`);
  const plan = createClosedPointerFlowPlan(fixture.source);
  const byOperation = new Map(pointerOperations(fixture.source).map((operation) => [
    operation.operation,
    plan.representationFor(operation.call),
  ]));

  assert.equal(byOperation.get("load"), "direct-snapshot");
  assert.equal(byOperation.get("hash-pointer"), "location");
  assert.equal(plan.optimizedComponentCount, 1);
});

test("falls back when any call site is outside the closed pointer graph", () => {
  const fixture = checkedPointerFixture(`import type { Pointer } from "./markers.js";
import { allocatePointer, loadPointer } from "./markers.js";
function read(pointer: Pointer<number>): number { return loadPointer(pointer); }
const pointer: Pointer<number> = allocatePointer(1);
read(pointer);
const selected = true ? pointer : pointer;
export const result = read(selected);
`);
  const plan = createClosedPointerFlowPlan(fixture.source);

  for (const operation of pointerOperations(fixture.source)) {
    assert.equal(plan.representationFor(operation.call), "location");
  }
});

test("rejects a modeled parameter flow when another call argument is unmodeled", () => {
  const fixture = checkedPointerFixture(`import type { Pointer } from "./markers.js";
import { allocatePointer, loadPointer } from "./markers.js";
declare const external: { readonly pointer: Pointer<number> };
function read(pointer: Pointer<number>): number { return loadPointer(pointer); }
const local = allocatePointer(1);
read(local);
export const result = read(external.pointer);
`);
  const plan = createClosedPointerFlowPlan(fixture.source);

  for (const operation of pointerOperations(fixture.source)) {
    assert.equal(plan.representationFor(operation.call), "location");
  }
  assert.ok(plan.components.some((component) =>
    component.blockers.includes("open-call")
  ));
});

test("keeps omitted-default and spread pointer bindings canonical", () => {
  const fixture = checkedPointerFixture(`import type { Pointer } from "./markers.js";
import { allocatePointer, loadPointer } from "./markers.js";
declare const externalArguments: [Pointer<number>];
function defaulted(pointer: Pointer<number> = allocatePointer(1)): number {
  return loadPointer(pointer);
}
function spread(pointer: Pointer<number>): number { return loadPointer(pointer); }
const local = allocatePointer(2);
spread(local);
defaulted();
export const result = spread(...externalArguments);
`);
  const plan = createClosedPointerFlowPlan(fixture.source);

  for (const operation of pointerOperations(fixture.source)) {
    assert.equal(plan.representationFor(operation.call), "location");
  }
});

test("joins repeated addresses of one storage before choosing representation", () => {
  const fixture = checkedPointerFixture(`import { addressOf, loadPointer, storePointer } from "./markers.js";
let value = 1;
const readonly = addressOf(value);
const writer = addressOf(value);
storePointer(writer, 2);
export const result = loadPointer(readonly);
`);
  const plan = createClosedPointerFlowPlan(fixture.source);

  for (const operation of pointerOperations(fixture.source)) {
    assert.equal(plan.representationFor(operation.call), "location");
  }
});

test("uses source navigation write evidence for addressed storage", () => {
  const fixture = checkedPointerFixture(`import { addressOf, loadPointer } from "./markers.js";
let value = 1;
const pointer = addressOf(value);
value ??= 2;
export const result = loadPointer(pointer);
`);
  const plan = createClosedPointerFlowPlan(fixture.source);

  for (const operation of pointerOperations(fixture.source)) {
    assert.equal(plan.representationFor(operation.call), "location");
  }
  assert.ok(plan.components.some((component) =>
    component.blockers.includes("addressed-storage-may-change")
  ));
});

test("uses a snapshot only for stable directly addressed scalar storage", () => {
  const fixture = checkedPointerFixture(`import { addressOf, loadPointer } from "./markers.js";
let value = 1;
const pointer = addressOf(value);
export const result = loadPointer(pointer);
`);
  const plan = createClosedPointerFlowPlan(fixture.source);

  assertRepresentations(fixture.source, plan, {
    "address-of": "direct-snapshot",
    load: "direct-snapshot",
  });
});

test("uses exact classes directly even when they carry value semantics", () => {
  const valueStruct = checkedPointerFixtureWithValueSemantics(`import type { Pointer } from "./markers.js";
import { allocatePointer, loadPointer } from "./markers.js";
class GoStruct { value = 1; }
const pointer: Pointer<GoStruct> = allocatePointer(new GoStruct());
export const result = loadPointer(pointer);
`, "GoStruct");

  assertRepresentations(
    valueStruct.source,
    createClosedPointerFlowPlan(valueStruct.source),
    { allocate: "direct-object", load: "direct-object" },
  );
});

test("rejects object-shaped pointees without exact class evidence", () => {
  const fixture = checkedPointerFixture(`import type { Pointer } from "./markers.js";
import { allocatePointer, loadPointer } from "./markers.js";
type GoArray = [number, number];
interface GoSliceHeader { data: number[]; length: number; capacity: number }
interface GoMap { values: Map<string, number> }
interface GoInterfaceBox { value: object; type: object }
const arrayPointer: Pointer<GoArray> = allocatePointer([1, 2]);
const slicePointer: Pointer<GoSliceHeader> = allocatePointer({ data: [1], length: 1, capacity: 1 });
const mapPointer: Pointer<GoMap> = allocatePointer({ values: new Map() });
const interfacePointer: Pointer<GoInterfaceBox> = allocatePointer({ value: {}, type: {} });
export const result = [
  loadPointer(arrayPointer),
  loadPointer(slicePointer),
  loadPointer(mapPointer),
  loadPointer(interfacePointer),
];
`);

  const plan = createClosedPointerFlowPlan(fixture.source);
  for (const operation of pointerOperations(fixture.source)) {
    assert.equal(plan.representationFor(operation.call), "location");
  }
  assert.ok(plan.components
    .filter((component) => component.operationCount > 0)
    .every((component) =>
      component.blockers.includes("unsupported-pointee")
    ));
});

test("composes pointer rewriting into one original-tree traversal", () => {
  const fixture = checkedPointerFixture(`import type { Pointer } from "./markers.js";
import { allocatePointer, loadPointer } from "./markers.js";
const pointer: Pointer<number> = allocatePointer(1);
export const result = loadPointer(pointer);
`);
  const flowPlan = createClosedPointerFlowPlan(fixture.source);
  const finalNodes = createFinalNodeJournal();
  const session = createPointerRewriteSession(
    fixture.source,
    fixture.sourceFile,
    flowPlan,
    finalNodes,
  );
  let composedRewrites = 0;
  const transformed = transformTargetSourceFile(
    fixture.sourceFile,
    (original, updated, factory) => {
      const rewritten = session.rewrite(original, updated, factory);
      const operation = fixture.source.sourceFacts.getFact(
        original,
        pointerOperationFactKey,
      );
      if (
        rewritten !== undefined &&
        operation?.operation === "allocate"
      ) {
        composedRewrites += 1;
        return finalNodes.record(
          original,
          NewParenthesizedExpression(factory, rewritten),
        );
      }
      return finalNodes.record(original, rewritten);
    },
  );
  assert.throws(
    () => finalNodes.record(fixture.sourceFile, transformed),
    /finalized twice/u,
  );
  const result = session.finish(transformed);
  const pointer = variableDeclarationNamed(
    fixture.source,
    result.sourceFile,
    "pointer",
  );

  assert.equal(composedRewrites, 1);
  assert.ok(IsParenthesizedExpression(pointer.Initializer));
  assert.throws(() => session.finish(transformed), /sealed twice/u);
});

test("rejects a flow plan from another checked program", () => {
  const first = checkedPointerFixture(`import { allocatePointer } from "./markers.js";
const pointer = allocatePointer(1);
`);
  const second = checkedPointerFixture(`import { allocatePointer } from "./markers.js";
const pointer = allocatePointer(2);
`);
  const plan = createClosedPointerFlowPlan(first.source);

  assert.throws(
    () => lowerPointers(second.source, second.sourceFile, plan),
    /different checked source program/u,
  );
});

test("falls back when a pointer crosses a captured flow", () => {
  const fixtures = [
    checkedPointerFixture(`import type { Pointer } from "./markers.js";
import { allocatePointer, loadPointer } from "./markers.js";
const pointer: Pointer<number> = allocatePointer(1);
const read = (): number => loadPointer(pointer);
export const result = read();
`),
  ];

  for (const [fixtureIndex, fixture] of fixtures.entries()) {
    const plan = createClosedPointerFlowPlan(fixture.source);
    for (const operation of pointerOperations(fixture.source)) {
      assert.equal(
        plan.representationFor(operation.call),
        "location",
        `escape fixture ${fixtureIndex}`,
      );
    }
  }
});

test("does not mistake a private local in an exported function for public ABI", () => {
  const fixture = checkedPointerFixture(`import type { Pointer } from "./markers.js";
import { allocatePointer, loadPointer } from "./markers.js";
export function run(): number {
  const pointer: Pointer<number> = allocatePointer(1);
  return loadPointer(pointer);
}
`);
  const plan = createClosedPointerFlowPlan(fixture.source);

  assertRepresentations(fixture.source, plan, {
    allocate: "direct-snapshot",
    load: "direct-snapshot",
  });
});

test("uses exact declarations rather than a same-spelled function", () => {
  const fixture = checkedPointerFixture(`import type { Pointer } from "./markers.js";
import { allocatePointer, loadPointer as markerLoad } from "./markers.js";
function loadPointer(value: number): number { return value + 100; }
const pointer: Pointer<number> = allocatePointer(1);
export const result = loadPointer(markerLoad(pointer));
`);
  const plan = createClosedPointerFlowPlan(fixture.source);

  assertRepresentations(fixture.source, plan, {
    allocate: "direct-snapshot",
    load: "direct-snapshot",
  });
});

test("keeps type-bearing pointer wrappers on the canonical representation", () => {
  const fixtures = [checkedPointerFixture(`import type { Pointer } from "./markers.js";
import { allocatePointer, loadPointer } from "./markers.js";
const pointer: Pointer<number> = allocatePointer(1);
export const result = loadPointer((pointer as Pointer<number>));
`), checkedPointerFixture(`import type { Pointer } from "./markers.js";
import { allocatePointer } from "./markers.js";
(allocatePointer(1) as Pointer<number>);
`)];

  for (const fixture of fixtures) {
    const plan = createClosedPointerFlowPlan(fixture.source);
    for (const operation of pointerOperations(fixture.source)) {
      assert.equal(plan.representationFor(operation.call), "location");
    }
  }
});

test("fails closed when an exact pointer-reference edge is removed", () => {
  const fixture = checkedPointerFixture(`import type { Pointer } from "./markers.js";
import { allocatePointer, loadPointer } from "./markers.js";
const pointer: Pointer<number> = allocatePointer(1);
const alias = pointer;
export const result = loadPointer(alias);
`);
  const source: TargetSourceProgram = Object.freeze({
    ...fixture.source,
    semantics: Object.freeze({
      ...fixture.source.semantics,
      forNode(node: Node) {
        const semantics = fixture.source.semantics.forNode(node);
        const omit = fixture.source.ast.is.IsIdentifier(node) &&
          fixture.source.ast.text(node) === "alias" &&
          fixture.source.ast.name(
            fixture.source.navigation.sourceReferenceFor(node)?.declaration,
          ) !== node;
        return omit ? Object.freeze({
          ...semantics,
          getSymbolAtLocation: () => undefined,
          getResolvedSymbol: () => undefined,
        }) : semantics;
      },
    }),
  });

  assert.throws(
    () => createClosedPointerFlowPlan(source),
    /pointer operand .* lost its exact source reference/u,
  );
});

function assertRepresentations(
  source: TargetSourceProgram,
  plan: ReturnType<typeof createClosedPointerFlowPlan>,
  expected: Readonly<Record<string, string>>,
): void {
  const actual: Record<string, string> = {};
  for (const operation of pointerOperations(source)) {
    actual[operation.operation] = plan.representationFor(operation.call);
  }
  assert.deepEqual(actual, expected);
}

function pointerOperations(source: TargetSourceProgram) {
  const operations: PointerOperationFact[] = [];
  for (const sourceFile of source.navigation.sourceFiles) {
    visit(source, sourceFile, (node) => {
      const operation = source.sourceFacts.getFact(node, pointerOperationFactKey);
      if (operation !== undefined) {
        operations.push(operation);
      }
    });
  }
  return operations;
}

function findNode(
  source: TargetSourceProgram,
  root: Node,
  predicate: (node: Node) => boolean,
): Node {
  let result: Node | undefined;
  visit(source, root, (node) => {
    if (result === undefined && predicate(node)) {
      result = node;
    }
  });
  assert.ok(result !== undefined);
  return result;
}

function countNodes(
  source: TargetSourceProgram,
  root: Node,
  predicate: (node: Node | undefined) => boolean,
): number {
  let count = 0;
  visit(source, root, (node) => {
    if (predicate(node)) {
      count += 1;
    }
  });
  return count;
}
