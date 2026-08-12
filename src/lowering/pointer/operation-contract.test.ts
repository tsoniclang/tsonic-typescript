import assert from "node:assert/strict";
import { test } from "node:test";

import { pointerOperationFactKey } from "@tsonic/tsts";
import type { PointerOperationFact } from "@tsonic/tsts";

import {
  checkedPointerFixture,
  visit,
} from "./pointer.test-support.js";
import { validatePointerOperationFact } from "./operation-contract.js";

test("rejects changed operation, pointee, location, provider, and projection facts", () => {
  const fixture = checkedPointerFixture(`
import {
  allocatePointer,
  bindPointer,
  loadPointer,
  projectPointer,
} from "./markers.js";
const numberPointer = allocatePointer<number>(1);
const stringPointer = allocatePointer<string>("one");
loadPointer(numberPointer);
let value = 1;
const bound = bindPointer<number>({}, () => value, next => { value = next; });
projectPointer<number, string>(bound, current => String(current), Number);
void stringPointer;
`);
  const operations = pointerOperations(fixture);
  const numberAllocation = requireOperation(operations, "allocate", 0);
  const stringAllocation = requireOperation(operations, "allocate", 1);
  const load = requireOperation(operations, "load", 0);
  const binding = requireOperation(operations, "bind-pointer", 0);
  const projection = requireOperation(operations, "project-pointer", 0);

  assert.throws(
    () => validatePointerOperationFact(fixture.source, {
      ...load,
      operation: "hash-pointer",
    }),
    /marker.*load.*hash-pointer/u,
  );
  assert.throws(
    () => validatePointerOperationFact(fixture.source, {
      ...numberAllocation,
      pointeeType: stringAllocation.pointeeType,
    }),
    /pointee/u,
  );
  assert.throws(
    () => validatePointerOperationFact(fixture.source, {
      ...numberAllocation,
      locationIdentity: stringAllocation.call,
    }),
    /location identity/u,
  );
  assert.throws(
    () => validatePointerOperationFact(fixture.source, {
      ...binding,
      readExpression: binding.writeExpression,
    }),
    /argument 1/u,
  );
  assert.throws(
    () => validatePointerOperationFact(fixture.source, {
      ...projection,
      toSourceExpression: projection.fromSourceExpression,
    }),
    /argument 2/u,
  );
});

function pointerOperations(
  fixture: ReturnType<typeof checkedPointerFixture>,
): readonly PointerOperationFact[] {
  const operations: PointerOperationFact[] = [];
  for (const sourceFile of fixture.source.navigation.sourceFiles) {
    visit(fixture.source, sourceFile, (node) => {
      const operation = fixture.source.sourceFacts.getFact(
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

function requireOperation<Kind extends PointerOperationFact["operation"]>(
  operations: readonly PointerOperationFact[],
  kind: Kind,
  ordinal: number,
): Extract<PointerOperationFact, { readonly operation: Kind }> {
  const operation = operations.filter(
    (candidate): candidate is Extract<
      PointerOperationFact,
      { readonly operation: Kind }
    > => candidate.operation === kind,
  )[ordinal];
  assert.ok(operation !== undefined, `Missing ${kind} operation ${ordinal}.`);
  return operation;
}
