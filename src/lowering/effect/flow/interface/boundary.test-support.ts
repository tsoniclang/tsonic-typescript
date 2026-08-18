import assert from "node:assert/strict";

import type { InterfaceContractComponent } from "./graph.js";

export function assertNoInterfaceBoundaryCauses(
  component: InterfaceContractComponent | undefined,
): void {
  const causes = component?.boundaryCauses ?? [];
  const summary = causes.map((cause) =>
    `${cause.reason}:${cause.occurrenceCount}`
  ).join(", ");
  assert.equal(
    causes.length,
    0,
    summary === "" ? "interface component is absent" : summary,
  );
}
