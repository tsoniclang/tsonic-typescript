import assert from "node:assert/strict";
import { test } from "node:test";

import {
  createCompilerSessionFromFiles,
  createSourceSemanticsExtension,
} from "@tsonic/tsts";
import type { Node, SourceFile } from "@tsonic/tsts";
import {
  createTargetSourceProgram,
} from "@tsonic/target-api";
import type { TargetSourceProgram } from "@tsonic/target-api";

import { createTargetProgramIndex } from "../program-index.js";
import { createPointerLoweringPlan } from "./plan.js";

test("plans addressed bindings with one source-reference pass", () => {
  const small = referenceLookupsFor(16);
  const large = referenceLookupsFor(32);

  assert.ok(large > small);
  assert.ok(
    large < small * 2.5,
    `reference lookups grew ${small} -> ${large}`,
  );
});

test("rejects parameter storage that escapes before its body", () => {
  const fixture = checkedSource(`import { addressOf } from "./markers.js";

export function capture(value: number, pointer = addressOf(value)) {
  return pointer;
}
`);
  assert.throws(
    () => createPointerLoweringPlan(
      fixture.source,
      fixture.sourceFile,
      pointerProgramIndex(fixture.source),
    ),
    /address-of parameter outside its function body is unsupported/,
  );
});

function referenceLookupsFor(bindingCount: number): number {
  const fixture = checkedFixture(bindingCount);
  let referenceLookups = 0;
  const source: TargetSourceProgram = Object.freeze({
    ...fixture.source,
    navigation: Object.freeze({
      ...fixture.source.navigation,
      sourceReferenceFor(node: Node | undefined) {
        referenceLookups += 1;
        return fixture.source.navigation.sourceReferenceFor(node);
      },
    }),
  });
  createPointerLoweringPlan(
    source,
    fixture.sourceFile,
    pointerProgramIndex(source),
  );
  return referenceLookups;
}

function pointerProgramIndex(source: TargetSourceProgram) {
  return createTargetProgramIndex(source, {
    bindingWrites: false,
    memberDispatch: false,
  });
}

function checkedFixture(bindingCount: number): {
  readonly source: TargetSourceProgram;
  readonly sourceFile: SourceFile;
} {
  const declarations = Array.from({ length: bindingCount }, (_, index) => `
  let value${index} = ${index};
  const pointer${index} = addressOf(value${index});
  value${index} += pointer${index} === undefined ? 0 : 1;`).join("");
  const values = Array.from(
    { length: bindingCount },
    (_, index) => `value${index}`,
  ).join(" + ");
  return checkedSource(`import { addressOf } from "./markers.js";

export function run(): number {${declarations}
  return ${values};
}
`);
}

function checkedSource(sourceText: string): {
  readonly source: TargetSourceProgram;
  readonly sourceFile: SourceFile;
} {
  const session = createCompilerSessionFromFiles({
    currentDirectory: "/src",
    files: {
      "/src/index.ts": sourceText,
      "/src/markers.ts":
        "export declare function addressOf<T>(storage: T): { value: T };",
    },
    rootFiles: ["/src/index.ts"],
    compilerOptions: {
      module: "esnext",
      moduleResolution: "bundler",
      strict: true,
      target: "es2022",
    },
    extensionHostOptions: {
      extensions: [createSourceSemanticsExtension({
        modules: [{
          moduleSpecifier: "./markers.js",
          capabilities: ["call-marker"],
          exports: [{
            kind: "call-marker",
            exportName: "addressOf",
            marker: "address-of",
          }],
        }],
      })],
    },
  });
  const checked = session.checkSource();
  assert.equal(checked.diagnostics.length, 0);
  assert.equal(checked.extensionDiagnostics.length, 0);
  const source = createTargetSourceProgram(checked);
  const sourceFile = source.navigation.sourceFiles.find(
    (candidate) => source.ast.getFileName(candidate) === "/src/index.ts",
  );
  assert.ok(sourceFile !== undefined);
  return { source, sourceFile };
}
