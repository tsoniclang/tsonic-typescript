import type { Node } from "@tsonic/tsts";
import type { TargetSourceProgram } from "@tsonic/target-api/source";
import { KindMethodSignature } from "@tsonic/tsts/target-ast";

import type { TargetProgramIndex } from "../../../program-index.js";
import {
  callableReturnRewrite,
  type CallableReturnRewrite,
} from "../../model/callable-contract.js";
import { isExactInterfaceProjectDeclaration } from "./declarations.js";

export interface InterfaceEffectContract {
  readonly declaration: Node;
  readonly owner: Node;
  readonly returnRewrite: CallableReturnRewrite;
}

export function collectInterfaceEffectContracts(
  source: TargetSourceProgram,
  program: TargetProgramIndex,
): readonly InterfaceEffectContract[] {
  const contracts: InterfaceEffectContract[] = [];
  for (const declaration of program.nodesOfKind(KindMethodSignature)) {
    const owner = source.ast.parent(declaration);
    const typeNode = source.ast.typeNode(declaration);
    if (
      owner === undefined ||
      !source.ast.is.IsInterfaceDeclaration(owner) ||
      !isExactInterfaceProjectDeclaration(source, owner) ||
      !isExactInterfaceProjectDeclaration(source, declaration) ||
      typeNode === undefined
    ) {
      continue;
    }
    const returnRewrite = callableReturnRewrite(source, typeNode);
    if (returnRewrite !== undefined) {
      contracts.push(Object.freeze({ declaration, owner, returnRewrite }));
    }
  }
  return Object.freeze(contracts);
}
