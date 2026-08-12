import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { test } from "node:test";

import { compareSourceDocumentIdentities } from "./source-order.js";

test("source document ordering is invariant across process locales", () => {
  assert.deepEqual(
    ["/project/ä.ts", "/project/z.ts"].sort(
      compareSourceDocumentIdentities,
    ),
    ["/project/z.ts", "/project/ä.ts"],
  );

  const moduleUrl = new URL("./source-order.js", import.meta.url).href;
  const program = `
    import { compareSourceDocumentIdentities } from ${JSON.stringify(moduleUrl)};
    process.stdout.write(JSON.stringify(
      ["/project/ä.ts", "/project/z.ts"].sort(compareSourceDocumentIdentities),
    ));
  `;
  for (const locale of ["en_US.UTF-8", "sv_SE.UTF-8"]) {
    const result = spawnSync(
      process.execPath,
      ["--input-type=module", "--eval", program],
      {
        encoding: "utf8",
        env: { ...process.env, LC_ALL: locale, LANG: locale },
      },
    );
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout, '["/project/z.ts","/project/ä.ts"]');
  }
});
