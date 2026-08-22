import type { Node } from "@tsonic/tsts";
import type { TargetSourceProgram } from "@tsonic/target-api/source";

import { typeScriptRuntimeReturnFactKey } from "./return-fact.js";

export interface TypeScriptRuntimeReturnContract {
  callResultIsDefinitelyNonThenable(call: Node): boolean;
}

export function createTypeScriptRuntimeReturnContract(
  source: TargetSourceProgram,
): TypeScriptRuntimeReturnContract {
  return Object.freeze({
    callResultIsDefinitelyNonThenable(call: Node): boolean {
      return source.sourceFacts.getFact(
        call,
        typeScriptRuntimeReturnFactKey,
      ) !== undefined;
    },
  });
}
