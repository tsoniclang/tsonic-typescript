import assert from "node:assert/strict";
import { test } from "node:test";

import type { TypeScriptAstPrinter } from "../print/ast-printer.js";
import {
  checkedSource,
  compileInput,
} from "./typescript-backend.test-support.js";
import { createTypeScriptBackend } from "./typescript-backend.js";

test("rejects an encoding failure atomically before invoking the printer", () => {
  const source = checkedSource({
    "/project/a.ts": "export const a = 1;\n",
    "/project/b.ts": "export const b = 2;\n",
  });
  const malformed = source.navigation.sourceFiles.find((sourceFile) =>
    source.documents.forFile(sourceFile).fileName === "/project/b.ts"
  );
  assert.ok(malformed !== undefined);
  malformed.ReferencedFiles = [undefined];
  let printCalls = 0;
  const printer: TypeScriptAstPrinter = {
    print() {
      printCalls += 1;
      return [];
    },
  };

  const result = createTypeScriptBackend(printer).compile(
    compileInput(source),
  );

  assert.equal(printCalls, 0);
  assert.deepEqual(result.artifacts, []);
  assert.equal(result.diagnostics.length, 1);
  assert.match(
    result.diagnostics[0]?.message ?? "",
    /^\/project\/b\.ts: source file reference is absent/u,
  );
});
