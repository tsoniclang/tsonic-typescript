import assert from "node:assert/strict";
import { test } from "node:test";

import {
  countAsyncCallables,
  createFixtureEffectPlan,
  checkedEffectFixture,
} from "../../test-support/fixture.test-support.js";
import { lowerCooperativeEffects } from "../../rewrite/transform.js";

test("settles a generated-shaped interface carried through project storage", () => {
  const fixture = checkedEffectFixture(`
import { observe, requireValue, sameValue } from "./runtime.js";
import { Adapter, type TypeData } from "./support.js";

type Awaitable<T> = T | PromiseLike<T>;

export class Type {
  public constructor(public data: TypeData | undefined) {}

  public static copy(source: Type): Type {
    return new Type(source.data);
  }

  public static equal(left: Type, right: Type): boolean {
    return sameValue(left.data, right.data);
  }

  public static async AsStructuredType(
    value: Type,
  ): Promise<number | undefined> {
    const receiver = value.data;
    return await requireValue(receiver).AsStructuredType();
  }
}

async function create(data: TypeData): Promise<number | undefined> {
  observe(data);
  const value = new Type(data);
  const copy = Type.copy(value);
  return await Type.AsStructuredType(copy);
}

export const result = await create(new Adapter());
`, {
    "/src/runtime.ts": `
export class GoInterfaceValue {}
export function requireValue<T extends GoInterfaceValue>(value: T | undefined): T {
  if (value === undefined) throw new Error("nil");
  return value;
}
export function observe(_value: GoInterfaceValue): void {}
export function sameValue(
  left: GoInterfaceValue | undefined,
  right: GoInterfaceValue | undefined,
): boolean { return left === right; }
`,
    "/src/support.ts": `
import { GoInterfaceValue } from "./runtime.js";

type Awaitable<T> = T | PromiseLike<T>;
export interface TypeData extends GoInterfaceValue {
  AsStructuredType(): Awaitable<number | undefined>;
}
export class Adapter extends GoInterfaceValue implements TypeData {
  public async AsStructuredType(): Promise<number | undefined> { return 42; }
}
`,
  });
  const plan = createFixtureEffectPlan(
    fixture.source,
    "declared-closed",
    undefined,
    "closed-program",
  );
  const rewritten = fixture.source.navigation.sourceFiles.map((sourceFile) =>
    lowerCooperativeEffects(sourceFile, plan)
  );
  plan.finish();

  assert.equal(
    rewritten.reduce(
      (total, file) =>
        total + countAsyncCallables(fixture.source, file.sourceFile),
      0,
    ),
    0,
  );
  const evidence = plan.summary.interfaceDispatch;
  assert.equal(evidence.analyzed, true);
  if (!evidence.analyzed) {
    throw new Error("declared interface dispatch was not analyzed");
  }
  assert.equal(evidence.consideredFamilyCount, 1);
  assert.equal(evidence.settledFamilyCount, 1);
  assert.equal(evidence.settledCallCount, 1);
});
