import assert from "node:assert/strict";
import { test } from "node:test";

import {
  encodeTargetSourceFileForPrinting,
  IsAsExpression,
  IsAwaitExpression,
  IsNewExpression,
} from "@tsonic/tsts/target-ast";
import type { AstReader, Node, SourceFile } from "@tsonic/tsts";
import type { TargetSourceProgram } from "@tsonic/target-api";

import { canonicalTypeScriptOptimizationProfile } from "./profile.js";
import {
  checkedPointerFixture,
  countCallsNamed,
  visit,
} from "./pointer/pointer.test-support.js";
import { lowerPointers } from "./pointer/transform.js";
import {
  prepareTypeScriptLowering,
  type TypeScriptLoweringTransaction,
} from "./transform.js";

const composedSource = `import {
  allocatePointer,
  loadPointer,
} from "./markers.js";
class Scalar {
  constructor(readonly value: number) {}
}
export const result = new Scalar(
  loadPointer(allocatePointer(41)),
).value;
`;

test("composes pointer and scalar lowering in one target-AST traversal", () => {
  const fixture = checkedPointerFixture(composedSource);
  const files = [...fixture.source.navigation.sourceFiles];
  const transaction = requireTransaction(prepareTypeScriptLowering(
    fixture.source,
    files,
    {
      pointerFlows: "closed-direct",
      scalarProjections: "closed-direct",
      cooperativeEffects: "preserve",
    },
    sourceIdentity(fixture),
  ));
  const results = files.map((sourceFile) => transaction.lower(sourceFile));
  transaction.finish();

  const result = results.find((candidate) =>
    fixture.source.ast.getFileName(candidate.sourceFile) === "/src/index.ts"
  );
  assert.ok(result !== undefined);
  assert.equal(result.pointer.operationCount, 2);
  assert.equal(result.pointer.runtimeAlias, undefined);
  assert.equal(result.scalar.projectionCount, 1);
  assert.equal(
    countCallsNamed(fixture.source, result.sourceFile, "allocatePointer"),
    0,
  );
  assert.equal(
    countCallsNamed(fixture.source, result.sourceFile, "loadPointer"),
    0,
  );
  assert.equal(countNodes(result.sourceFile, fixture.source, IsNewExpression), 0);
  assert.equal(countNodes(result.sourceFile, fixture.source, IsAsExpression), 1);
});

test("composes pointer scalar and effect rewrites over one expression", () => {
  const fixture = checkedPointerFixture(`import {
  allocatePointer,
  loadPointer,
} from "./markers.js";
class Scalar {
  constructor(readonly value: number) {}
}
async function compute(): Promise<number> {
  return new Scalar(loadPointer(allocatePointer(41))).value;
}
export const result = await compute();
`);
  const files = [...fixture.source.navigation.sourceFiles];
  const transaction = requireTransaction(prepareTypeScriptLowering(
    fixture.source,
    files,
    {
      pointerFlows: "closed-direct",
      scalarProjections: "closed-direct",
      cooperativeEffects: "closed-direct",
    },
    sourceIdentity(fixture),
  ));
  const lowered = files.map((sourceFile) => transaction.lower(sourceFile));
  transaction.finish();
  const result = lowered.find((candidate) =>
    candidate.sourceFile !== undefined &&
    fixture.source.ast.getFileName(candidate.sourceFile) === "/src/index.ts"
  );

  assert.ok(result !== undefined);
  assert.equal(result.pointer.operationCount, 2);
  assert.equal(result.scalar.projectionCount, 1);
  assert.equal(result.effect?.callableCount, 1);
  assert.equal(
    countNodes(result.sourceFile, fixture.source, (node) =>
      fixture.source.ast.hasModifierKind(node, "async")
    ),
    0,
  );
  assert.equal(countNodes(result.sourceFile, fixture.source, IsAwaitExpression), 0);
  assert.equal(countNodes(result.sourceFile, fixture.source, IsNewExpression), 0);
  assert.equal(countCallsNamed(fixture.source, result.sourceFile, "allocatePointer"), 0);
  assert.equal(countCallsNamed(fixture.source, result.sourceFile, "loadPointer"), 0);
});

test("composes identity-callable specialization with effect settlement", () => {
  const fixture = checkedPointerFixture(`type Awaitable<T> = T | PromiseLike<T>;
async function kernel(
  copy: (value: number) => Awaitable<number>,
  value: number,
): Promise<number> {
  return await copy(value);
}
export const result = await kernel((value: number): number => value, 41);
`);
  const files = [...fixture.source.navigation.sourceFiles];
  const transaction = requireTransaction(prepareTypeScriptLowering(
    fixture.source,
    files,
    {
      pointerFlows: "closed-direct",
      scalarProjections: "closed-direct",
      representationProjections: "closed-direct",
      cooperativeEffects: "closed-direct",
    },
    sourceIdentity(fixture),
  ));
  const lowered = files.map((sourceFile) => transaction.lower(sourceFile));
  transaction.finish();
  const result = lowered.find((candidate) =>
    fixture.source.ast.getFileName(candidate.sourceFile) === "/src/index.ts"
  );
  assert.ok(result !== undefined);

  let kernel: Node | undefined;
  visit(fixture.source, result.sourceFile, (node) => {
    if (
      fixture.source.ast.is.IsFunctionDeclaration(node) &&
      fixture.source.ast.text(fixture.source.ast.name(node)) === "kernel"
    ) {
      kernel = node;
    }
  });
  assert.ok(kernel !== undefined);
  assert.equal(fixture.source.ast.parameters(kernel).length, 1);
  assert.equal(result.representation.callableParameterCount, 1);
  assert.equal(result.representation.callableArgumentCount, 1);
  assert.equal(result.representation.callableInvocationCount, 1);
  assert.equal(result.effect?.callableCount, 1);
  assert.equal(countCallsNamed(fixture.source, result.sourceFile, "copy"), 0);
  assert.equal(countCallsNamed(fixture.source, result.sourceFile, "kernel"), 1);
  assert.equal(
    countNodes(result.sourceFile, fixture.source, (node) =>
      fixture.source.ast.hasModifierKind(node, "async")
    ),
    0,
  );
  assert.equal(countNodes(result.sourceFile, fixture.source, IsAwaitExpression), 0);
});

test("effect settlement preserves a nonidentity converter contract", () => {
  const fixture = checkedPointerFixture(`declare const storage: unique symbol;
interface Stored<Value> { readonly [storage]: Value; }
type ContainerStorage<Value> = Value extends Stored<infer Storage> ? Storage : Value;
class Values<Value> {
  public constructor(public readonly value: Value) {}
}
function identity<Value>(value: Value): Value { return value; }
async function kernel<Value>(
  fromStorage: (value: ContainerStorage<Value>) => Value,
  values: Values<ContainerStorage<Value>>,
): Promise<Value> {
  return fromStorage(values.value);
}
export const result = await kernel<number>(identity, new Values<number>(41));
`);
  const files = [...fixture.source.navigation.sourceFiles];
  const transaction = requireTransaction(prepareTypeScriptLowering(
    fixture.source,
    files,
    {
      pointerFlows: "closed-direct",
      scalarProjections: "closed-direct",
      representationProjections: "closed-direct",
      cooperativeEffects: "closed-direct",
    },
    sourceIdentity(fixture),
  ));
  const lowered = files.map((sourceFile) => transaction.lower(sourceFile));
  transaction.finish();
  const result = lowered.find((candidate) =>
    fixture.source.ast.getFileName(candidate.sourceFile) === "/src/index.ts"
  );
  assert.ok(result !== undefined);

  let kernel: Node | undefined;
  visit(fixture.source, result.sourceFile, (node) => {
    if (
      fixture.source.ast.is.IsFunctionDeclaration(node) &&
      fixture.source.ast.text(fixture.source.ast.name(node)) === "kernel"
    ) {
      kernel = node;
    }
  });
  assert.ok(kernel !== undefined);
  assert.equal(fixture.source.ast.parameters(kernel).length, 2);
  assert.equal(result.representation.callableParameterCount, 0);
  assert.equal(result.effect?.callableCount, 1);
  assert.equal(
    countNodes(result.sourceFile, fixture.source, (node) =>
      fixture.source.ast.hasModifierKind(node, "async")
    ),
    0,
  );
  assert.equal(
    countNodes(result.sourceFile, fixture.source, IsAwaitExpression),
    0,
  );
  const callableEvidence = transaction.evidence.representationProjections
    .identityCallables;
  assert.equal(callableEvidence.optimizedCount, 0);
  assert.deepEqual(callableEvidence.fallbackReasons.map((row) => row.reason), [
    "nonidentity-contract",
  ]);
});

test("shares one canonical node census across complete-flow planners", () => {
  const fixture = checkedPointerFixture(composedSource);
  const nodes = new Set<Node>();
  for (const sourceFile of fixture.source.navigation.sourceFiles) {
    visit(fixture.source, sourceFile, (node) => nodes.add(node));
  }
  let childLookups = 0;
  const ast: AstReader = Object.freeze({
    ...fixture.source.ast,
    children(node: Parameters<AstReader["children"]>[0]) {
      childLookups += 1;
      return fixture.source.ast.children(node);
    },
  });
  const source: TargetSourceProgram = Object.freeze({
    ast,
    sourceFiles: fixture.source.sourceFiles,
    documents: fixture.source.documents,
    sourceFacts: fixture.source.sourceFacts,
    navigation: fixture.source.navigation,
    semantics: fixture.source.semantics,
  });
  const files = [...source.navigation.sourceFiles];
  let identityLookups = 0;

  const transaction = requireTransaction(prepareTypeScriptLowering(
    source,
    files,
    canonicalTypeScriptOptimizationProfile(),
    (sourceFile) => {
      identityLookups += 1;
      return fixture.source.documents.forFile(sourceFile).identity;
    },
  ));
  for (const sourceFile of files) {
    transaction.lower(sourceFile);
  }
  transaction.finish();

  assert.ok(
    childLookups < nodes.size * 4,
    `lowering performed ${childLookups} child lookups for ${nodes.size} nodes`,
  );
  assert.equal(identityLookups, files.length);
});

test("composes callable storage and callable return narrowing atomically", () => {
  const fixture = checkedPointerFixture(`
type Awaitable<T> = T | PromiseLike<T>;
class Slot {
  private constructor(public value: (() => Awaitable<number>) | undefined) {}
  static zero(): Slot { return new Slot(undefined); }
}
const slot = Slot.zero();
slot.value = async (): Promise<number> => 41;
export async function invoke(selected: boolean): Promise<number> {
  let callback: (() => Awaitable<number>) | undefined = slot.value;
  if (selected) callback = slot.value;
  return (await callback!()) + 1;
}
export const result = await invoke(true);
`);
  const files = [...fixture.source.navigation.sourceFiles];
  const transaction = requireTransaction(prepareTypeScriptLowering(
    fixture.source,
    files,
    {
      pointerFlows: "closed-direct",
      scalarProjections: "closed-direct",
      cooperativeEffects: "closed-direct",
    },
    sourceIdentity(fixture),
  ));
  let transformed: SourceFile | undefined;
  for (const sourceFile of files) {
    const result = transaction.lower(sourceFile);
    if (sourceFile === fixture.sourceFile) {
      transformed = result.sourceFile;
    }
  }
  transaction.finish();

  assert.ok(transformed !== undefined);
  const remainingContracts: string[] = [];
  countNodes(transformed, fixture.source, (node) => {
    const reference = fixture.source.ast.as.AsTypeReferenceNode(node);
    if (reference === undefined) {
      return false;
    }
    const name = fixture.source.ast.text(reference.TypeName);
    if (name === "Awaitable" || name === "Promise") {
      remainingContracts.push(
        `${name}:${fixture.source.ast.kindName(fixture.source.ast.parent(node))}`,
      );
    }
    return false;
  });
  assert.deepEqual(remainingContracts, []);
});

test("settles a pointer-producing return from its exact lowering fact", () => {
  const fixture = checkedPointerFixture(`
import { addressOf, type Pointer } from "./markers.js";
const record = { value: 41 };
async function select(): Promise<Pointer<number>> {
  return addressOf(record.value);
}
export const result = await select();
`);
  const files = [...fixture.source.navigation.sourceFiles];
  const transaction = requireTransaction(prepareTypeScriptLowering(
    fixture.source,
    files,
    {
      pointerFlows: "location",
      scalarProjections: "closed-direct",
      cooperativeEffects: "closed-direct",
    },
    sourceIdentity(fixture),
  ));
  let transformed: SourceFile | undefined;
  for (const sourceFile of files) {
    const result = transaction.lower(sourceFile);
    if (sourceFile === fixture.sourceFile) {
      transformed = result.sourceFile;
    }
  }
  transaction.finish();

  assert.ok(transformed !== undefined);
  assert.equal(
    countNodes(transformed, fixture.source, (node) =>
      fixture.source.ast.hasModifierKind(node, "async")
    ),
    0,
  );
  assert.equal(
    countNodes(transformed, fixture.source, IsAwaitExpression),
    0,
  );
  assert.equal(countCallsNamed(fixture.source, transformed, "addressOf"), 0);
});

test("does not treat a same-spelled ordinary call as a pointer result", () => {
  const fixture = checkedPointerFixture(`
interface Box<T> { readonly value: T }
declare function addressOf<T>(value: T): Box<T>;
async function select(): Promise<Box<number>> {
  return addressOf(41);
}
export const result = await select();
`);
  const files = [...fixture.source.navigation.sourceFiles];
  const transaction = requireTransaction(prepareTypeScriptLowering(
    fixture.source,
    files,
    {
      pointerFlows: "location",
      scalarProjections: "closed-direct",
      cooperativeEffects: "closed-direct",
    },
    sourceIdentity(fixture),
  ));
  let transformed: SourceFile | undefined;
  for (const sourceFile of files) {
    const result = transaction.lower(sourceFile);
    if (sourceFile === fixture.sourceFile) {
      transformed = result.sourceFile;
    }
  }
  transaction.finish();

  assert.ok(transformed !== undefined);
  assert.equal(
    countNodes(transformed, fixture.source, (node) =>
      fixture.source.ast.hasModifierKind(node, "async")
    ),
    1,
  );
  assert.equal(
    countNodes(transformed, fixture.source, IsAwaitExpression),
    1,
  );
});

test("preserves a thenable loaded through an exact pointer fact", () => {
  const fixture = checkedPointerFixture(`
import { allocatePointer, loadPointer } from "./markers.js";
const pointer = allocatePointer(Promise.resolve(41));
async function select(): Promise<number> {
  return loadPointer(pointer);
}
export const result = await select();
`);
  const files = [...fixture.source.navigation.sourceFiles];
  const transaction = requireTransaction(prepareTypeScriptLowering(
    fixture.source,
    files,
    {
      pointerFlows: "location",
      scalarProjections: "closed-direct",
      cooperativeEffects: "closed-direct",
    },
    sourceIdentity(fixture),
  ));
  let transformed: SourceFile | undefined;
  for (const sourceFile of files) {
    const result = transaction.lower(sourceFile);
    if (sourceFile === fixture.sourceFile) {
      transformed = result.sourceFile;
    }
  }
  transaction.finish();

  assert.ok(transformed !== undefined);
  assert.equal(
    countNodes(transformed, fixture.source, (node) =>
      fixture.source.ast.hasModifierKind(node, "async")
    ),
    1,
  );
  assert.equal(
    countNodes(transformed, fixture.source, IsAwaitExpression),
    1,
  );
});

test("canonical transaction is byte-identical to canonical pointer lowering", () => {
  const fixture = checkedPointerFixture(composedSource);
  const canonical = lowerPointers(fixture.source, fixture.sourceFile);
  const files = [...fixture.source.navigation.sourceFiles];
  const transaction = requireTransaction(prepareTypeScriptLowering(
    fixture.source,
    files,
    canonicalTypeScriptOptimizationProfile(),
    sourceIdentity(fixture),
  ));
  let transformed: SourceFile | undefined;
  for (const sourceFile of files) {
    const result = transaction.lower(sourceFile);
    if (sourceFile === fixture.sourceFile) {
      transformed = result.sourceFile;
    }
  }
  transaction.finish();
  assert.ok(transformed !== undefined);
  assert.deepEqual(
    encodeTargetSourceFileForPrinting(transformed),
    encodeTargetSourceFileForPrinting(canonical.sourceFile),
  );
});

test("requires one exact complete source membership", () => {
  const fixture = checkedPointerFixture(composedSource);
  const files = [...fixture.source.navigation.sourceFiles];
  assert.ok(files.length > 1);
  assert.throws(
    () => prepareTypeScriptLowering(
      fixture.source,
      files.slice(1),
      canonicalTypeScriptOptimizationProfile(),
      sourceIdentity(fixture),
    ),
    /every exact checked project source file once/,
  );
  assert.throws(
    () => prepareTypeScriptLowering(
      fixture.source,
      [...files, files[0] as SourceFile],
      canonicalTypeScriptOptimizationProfile(),
      sourceIdentity(fixture),
    ),
    /every exact checked project source file once/,
  );
  assert.throws(
    () => prepareTypeScriptLowering(
      fixture.source,
      files,
      canonicalTypeScriptOptimizationProfile(),
      () => "duplicate.ts",
    ),
    /one non-empty identity per checked source file/,
  );
});

test("seals one lowering transaction after exact consumption", () => {
  const fixture = checkedPointerFixture(composedSource);
  const files = [...fixture.source.navigation.sourceFiles];

  const duplicate = newTransaction(fixture, files);
  duplicate.lower(files[0] as SourceFile);
  assert.throws(
    () => duplicate.lower(files[0] as SourceFile),
    /visited a source file twice/,
  );

  const incomplete = newTransaction(fixture, files);
  incomplete.lower(files[0] as SourceFile);
  assert.throws(
    () => incomplete.finish(),
    /consumed 1 source files, expected 2/,
  );

  const complete = newTransaction(fixture, files);
  for (const sourceFile of files) {
    complete.lower(sourceFile);
  }
  complete.finish();
  assert.throws(
    () => complete.finish(),
    /sealed twice/,
  );
});

function newTransaction(
  fixture: ReturnType<typeof checkedPointerFixture>,
  files: readonly SourceFile[],
): TypeScriptLoweringTransaction {
  return requireTransaction(prepareTypeScriptLowering(
    fixture.source,
    files,
    canonicalTypeScriptOptimizationProfile(),
    sourceIdentity(fixture),
  ));
}

function sourceIdentity(
  fixture: ReturnType<typeof checkedPointerFixture>,
): (sourceFile: SourceFile) => string {
  return (sourceFile) => fixture.source.documents.forFile(sourceFile).identity;
}

function requireTransaction(
  preparation: ReturnType<typeof prepareTypeScriptLowering>,
): TypeScriptLoweringTransaction {
  assert.equal(preparation.kind, "ready");
  if (preparation.kind !== "ready") {
    assert.fail("TypeScript lowering preparation was rejected");
  }
  return preparation.transaction;
}

function countNodes(
  root: Node,
  source: ReturnType<typeof checkedPointerFixture>["source"],
  predicate: (node: Node) => boolean,
): number {
  let count = 0;
  visit(source, root, (node) => {
    if (predicate(node)) {
      count += 1;
    }
  });
  return count;
}
