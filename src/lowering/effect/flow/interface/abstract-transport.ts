import type { Node } from "@tsonic/tsts";
import type { TargetSourceProgram } from "@tsonic/target-api/source";

import type {
  InvocationTransport,
  InvocationTransportContract,
} from "../../../invocation-transport.js";
import { exactSourceCallBindings } from "../invocation/call-binding.js";
import type { ExactCallableBodyInspection } from "../callable/result-inputs.js";
import { sourceBodyInspectionIsExact } from "../../model/source-membership.js";
import { collectInterfaceContractComponent } from "./component.js";
import type { InterfaceContractIndex } from "./graph.js";

export interface AbstractInvocationTransportSelection {
  readonly calls: readonly Node[];
  readonly contract: InvocationTransportContract;
}

export function createAbstractInvocationTransports(
  source: TargetSourceProgram,
  contracts: InterfaceContractIndex,
  bodyInspectionIsCertified?: ExactCallableBodyInspection,
): AbstractInvocationTransportSelection | undefined {
  const transports = new Map<Node, InvocationTransport>();
  const visited = new Set<Node>();
  for (const entry of contracts.entries.values()) {
    if (!entry.abstractTransport || visited.has(entry.declaration)) {
      continue;
    }
    const declarations = collectInterfaceContractComponent(
      entry.declaration,
      contracts.links,
      visited,
    );
    if (
      contracts.boundaries.causesFor(declarations).length !== 0 ||
      !componentHasExactImplementations(
        source,
        contracts,
        declarations,
        bodyInspectionIsCertified,
      )
    ) {
      continue;
    }
    const selected = declarations.flatMap((declaration) => {
      const contract = contracts.entries.get(declaration);
      return contract?.abstractTransport === true ? [contract] : [];
    });
    const pending: Array<readonly [Node, InvocationTransport]> = [];
    let complete = true;
    for (const contract of selected) {
      for (const call of contract.calls) {
        const transport = abstractCallTransport(
          source,
          call,
          contract.declaration,
        );
        if (transport === undefined) {
          complete = false;
          break;
        }
        pending.push([call, transport] as const);
      }
      if (!complete) {
        break;
      }
    }
    if (!complete) {
      continue;
    }
    for (const [call, transport] of pending) {
      if (transports.has(call)) {
        throw new Error(
          "abstract invocation belongs to multiple contract components",
        );
      }
      transports.set(call, transport);
    }
  }
  if (transports.size === 0) {
    return undefined;
  }
  return Object.freeze({
    calls: Object.freeze([...transports.keys()]),
    contract: Object.freeze({
        transportFor(call: Node): InvocationTransport | undefined {
          return transports.get(call);
        },
      }),
  });
}

function componentHasExactImplementations(
  source: TargetSourceProgram,
  contracts: InterfaceContractIndex,
  declarations: readonly Node[],
  bodyInspectionIsCertified: ExactCallableBodyInspection | undefined,
): boolean {
  for (const declaration of declarations) {
    const entry = contracts.entries.get(declaration);
    if (entry?.abstractTransport !== true) {
      continue;
    }
    const implementations = contracts.implementations.implementationsFor(
      declaration,
    );
    if (
      implementations.length === 0 ||
      implementations.some((implementation) =>
        !sourceBodyInspectionIsExact(
          source,
          implementation,
          bodyInspectionIsCertified,
        ) || source.ast.body(implementation) === undefined
      )
    ) {
      return false;
    }
  }
  return true;
}

function abstractCallTransport(
  source: TargetSourceProgram,
  call: Node,
  declaration: Node,
): InvocationTransport | undefined {
  const bindings = exactSourceCallBindings(source, call);
  const resolved = source.semantics.forNode(call).operations.call(call);
  const receiver = resolved?.sourceReceiver?.expression ??
    resolved?.sourceCalleeAccess?.receiver.expression;
  if (
    bindings === undefined ||
    bindings.declaration !== declaration ||
    receiver === undefined
  ) {
    return undefined;
  }
  return Object.freeze({
    inputExpressions: Object.freeze([
      ...new Set(bindings.bindings.map((binding) => binding.argument)),
    ]),
    resultOriginExpressions: Object.freeze([receiver]),
  });
}
