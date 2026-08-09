import assert from "node:assert/strict";
import { test } from "node:test";

import type { Node, SourceFile } from "@tsonic/tsts";
import {
  AsVariableDeclarationList,
  AsVariableStatement,
  IsFunctionDeclaration,
  IsVariableDeclarationList,
  IsVariableStatement,
} from "@tsonic/tsts/target-ast";
import type { TargetSourceProgram } from "@tsonic/target-api";

import {
  checkedPointerFixture,
  containsNode,
  variableDeclarationNamed,
  visit,
} from "./pointer.test-support.js";
import { lowerPointers } from "./transform.js";

test("reuses one live companion for repeated addresses of one local", () => {
  const fixture = checkedPointerFixture(`import { addressOf, equalPointer } from "./markers.js";

let value = 1;
const first = addressOf(value);
const second = addressOf(value);
export const same = equalPointer(first, second);
`);
  const result = lowerPointers(fixture.source, fixture.sourceFile);

  assert.equal(result.locationBindingCount, 1);
  assert.equal(
    variableDeclarationsNamed(fixture.source, result.sourceFile, "value$location"),
    1,
  );
  assert.equal(
    identifiersNamed(fixture.source, result.sourceFile, "value$location"),
    3,
  );
});

test("keeps exported value storage public and its companion private", () => {
  const fixture = checkedPointerFixture(`import { addressOf } from "./markers.js";

export let value = 1;
export const pointer = addressOf(value);
`);
  const result = lowerPointers(fixture.source, fixture.sourceFile);
  const value = variableDeclarationNamed(fixture.source, result.sourceFile, "value");
  const location = variableDeclarationNamed(
    fixture.source,
    result.sourceFile,
    "value$location",
  );

  assert.equal(
    fixture.source.ast.hasModifierKind(
      variableStatement(fixture.source, result.sourceFile, value),
      "export",
    ),
    true,
  );
  assert.equal(
    fixture.source.ast.hasModifierKind(
      variableStatement(fixture.source, result.sourceFile, location),
      "export",
    ),
    false,
  );
});

test("preserves declarator order while inserting one addressed-let companion", () => {
  const fixture = checkedPointerFixture(`import { addressOf } from "./markers.js";

const events: string[] = [];
function mark(name: string, value: number): number {
  events.push(name);
  return value;
}
let first = mark("first", 1), second = mark("second", 2);
const pointer = addressOf(first);
export const result = [events, first, second, pointer];
`);
  const result = lowerPointers(fixture.source, fixture.sourceFile);

  assert.deepEqual(topLevelVariableNames(fixture.source, result.sourceFile), [
    "events",
    "first",
    "first$location",
    "second",
    "pointer",
    "result",
  ]);
});

test("creates var storage identity at function scope entry", () => {
  const fixture = checkedPointerFixture(`import { addressOf, loadPointer } from "./markers.js";

export function run(): number {
  var value = 3;
  const pointer = addressOf(value);
  return loadPointer(pointer);
}
`);
  const result = lowerPointers(fixture.source, fixture.sourceFile);
  const declaration = findNode(
    fixture.source,
    result.sourceFile,
    (node) => IsFunctionDeclaration(node) &&
      fixture.source.ast.text(fixture.source.ast.name(node)) === "run",
  );
  const body = fixture.source.ast.body(declaration);
  assert.ok(body !== undefined);

  assert.deepEqual(statementVariableNames(fixture.source, body), [
    "value$location",
    "value",
    "pointer",
  ]);
});

for (const loop of [
  {
    name: "classic for",
    source: `for (let value = 0; value < 1; value += 1) {
    const pointer = addressOf(value);
    void pointer;
  }`,
  },
  {
    name: "for-of",
    source: `for (let value of [1]) {
    const pointer = addressOf(value);
    void pointer;
  }`,
  },
  {
    name: "for-in",
    source: `for (let value in { item: 1 }) {
    const pointer = addressOf(value);
    void pointer;
  }`,
  },
] as const) {
  test(`rejects addressed ${loop.name} let storage instead of capturing a stale cell`, () => {
    const fixture = checkedPointerFixture(`import { addressOf } from "./markers.js";

export function run(): void {
  ${loop.source}
}
`);

    assert.throws(
      () => lowerPointers(fixture.source, fixture.sourceFile),
      /address-of does not support let bindings with per-iteration loop storage/u,
    );
  });
}

test("rejects private-field storage instead of emitting a string-key approximation", () => {
  const fixture = checkedPointerFixture(`import { addressOf } from "./markers.js";

class Box {
  #value = 1;
  pointer() { return addressOf(this.#value); }
}
export const box = new Box();
`);

  assert.throws(
    () => lowerPointers(fixture.source, fixture.sourceFile),
    /address-of does not support private field storage/u,
  );
});

function variableDeclarationsNamed(
  source: TargetSourceProgram,
  sourceFile: SourceFile,
  name: string,
): number {
  let count = 0;
  visit(source, sourceFile, (node) => {
    if (
      source.ast.is.IsVariableDeclaration(node) &&
      source.ast.text(source.ast.name(node)) === name
    ) {
      count += 1;
    }
  });
  return count;
}

function identifiersNamed(
  source: TargetSourceProgram,
  sourceFile: SourceFile,
  name: string,
): number {
  let count = 0;
  visit(source, sourceFile, (node) => {
    if (source.ast.is.IsIdentifier(node) && source.ast.text(node) === name) {
      count += 1;
    }
  });
  return count;
}

function variableStatement(
  source: TargetSourceProgram,
  sourceFile: SourceFile,
  declaration: Node,
): Node {
  return findNode(source, sourceFile, (node) =>
    IsVariableStatement(node) && containsNode(source, node, declaration)
  );
}

function topLevelVariableNames(
  source: TargetSourceProgram,
  sourceFile: SourceFile,
): readonly string[] {
  return statementVariableNames(source, sourceFile);
}

function statementVariableNames(
  source: TargetSourceProgram,
  owner: Node,
): readonly string[] {
  return source.ast.statements(owner).flatMap((statement) => {
    if (!IsVariableStatement(statement)) {
      return [];
    }
    const listNode = AsVariableStatement(statement)?.DeclarationList;
    assert.ok(listNode !== undefined && IsVariableDeclarationList(listNode));
    const list = AsVariableDeclarationList(listNode);
    return (list?.Declarations?.Nodes ?? []).map((declaration) =>
      source.ast.text(source.ast.name(declaration))
    );
  });
}

function findNode(
  source: TargetSourceProgram,
  sourceFile: SourceFile,
  predicate: (node: Node) => boolean,
): Node {
  let found: Node | undefined;
  visit(source, sourceFile, (node) => {
    if (found === undefined && predicate(node)) {
      found = node;
    }
  });
  assert.ok(found !== undefined);
  return found;
}
