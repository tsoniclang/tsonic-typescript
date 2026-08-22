import type { Node } from "@tsonic/tsts";

import type { InterfaceContractIngress } from "../ingress.js";
import { resolveInterfaceOrigins } from "./resolution.js";

export type InterfaceOriginRequirementKind =
  | "ingress"
  | "opaque-result"
  | "receiver";

export interface InterfaceOriginRequirements {
  require(
    value: Node,
    contract: Node,
    kind: InterfaceOriginRequirementKind,
  ): void;
  requiredValues(): readonly Node[];
  finish(ingress: InterfaceContractIngress): void;
}

export function createInterfaceOriginRequirements():
  InterfaceOriginRequirements {
  const requests = new Map<Node, Map<Node, Set<InterfaceOriginRequirementKind>>>();
  let finished = false;
  return Object.freeze({
    require(
      value: Node,
      contract: Node,
      kind: InterfaceOriginRequirementKind,
    ): void {
      if (finished) {
        throw new Error("interface origin requirements are already sealed");
      }
      let values = requests.get(contract);
      if (values === undefined) {
        values = new Map();
        requests.set(contract, values);
      }
      let kinds = values.get(value);
      if (kinds === undefined) {
        kinds = new Set();
        values.set(value, kinds);
      }
      kinds.add(kind);
    },
    requiredValues(): readonly Node[] {
      if (finished) {
        throw new Error("interface origin requirements are already sealed");
      }
      return Object.freeze([
        ...new Set([...requests.values()].flatMap((values) => [...values.keys()])),
      ]);
    },
    finish(ingress: InterfaceContractIngress): void {
      if (finished) {
        throw new Error("interface origin requirements were sealed twice");
      }
      finished = true;
      for (const [contract, values] of requests) {
        const resolutions = resolveInterfaceOrigins(
          values.keys(),
          contract,
          ingress,
        );
        for (const [value, kinds] of values) {
          const resolution = resolutions.resolutionFor(value);
          if (resolution.closed) {
            continue;
          }
          for (const kind of kinds) {
            markOpenOrigin(contract, value, kind, resolution.opaque, ingress);
          }
        }
      }
    },
  });
}

function markOpenOrigin(
  contract: Node,
  occurrence: Node,
  kind: InterfaceOriginRequirementKind,
  opaque: boolean,
  ingress: InterfaceContractIngress,
): void {
  if (kind === "receiver") {
    ingress.boundaries.mark(contract, "open-interface-receiver", occurrence);
    if (opaque) {
      ingress.boundaries.mark(contract, "opaque-call-transport", occurrence);
    }
    return;
  }
  ingress.boundaries.mark(
    contract,
    kind === "opaque-result" || opaque
      ? "opaque-call-transport"
      : "unproven-value-origin",
    occurrence,
  );
}
