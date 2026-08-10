import assert from "node:assert/strict";
import { test } from "node:test";

import {
  boundLocation,
  location,
  nestedPropertyLocation,
  projectLocation,
  propertyLocation,
  rawPointer,
} from "@tsonic/typescript-runtime";

test("certified runtime constructors produce non-thenable values", () => {
  const object = { value: 1 };
  const root = location(object);
  const values = [
    location(1),
    boundLocation({}, () => 1, () => undefined),
    propertyLocation(object, "value"),
    nestedPropertyLocation(root, "value"),
    projectLocation(location(1), (value) => value, (value) => value),
    rawPointer({}),
  ];

  for (const value of values) {
    assert.equal("then" in value, false);
  }
});
