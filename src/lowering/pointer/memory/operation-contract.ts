import type { Node, ProviderVirtualDeclarationFact } from "@tsonic/tsts";
import type { TargetSourceProgram } from "@tsonic/target-api/source";
import type { TsonicRawMemoryOperationFact, TsonicKeepAliveFact } from "@tsonic/source-core/facts";
import { PointerLoweringError } from "../diagnostic.js";

export function validateKeepAliveCall(source: TargetSourceProgram, selected: ProviderVirtualDeclarationFact, fact: TsonicKeepAliveFact): void {
  const args = source.ast.arguments(fact.call);
  const semantics = source.semantics.forNode(fact.call);
  const call = semantics.operations.call(fact.call);
  const operand = call?.sourceArguments[0];
  if (selected.exportId !== "keepAlive" || args.length !== 1 || args[0] !== fact.valueExpression ||
      call === undefined || operand === undefined || operand.expression !== fact.valueExpression ||
      !semantics.types.isIdentical(operand.type, fact.valueType) ||
      !semantics.types.isIdentical(call.sourceResultType, fact.resultType)) {
    throw new PointerLoweringError("lifetime fact disagrees with its selected declaration, operand or result");
  }
}

export function validateRawMemoryCall(source: TargetSourceProgram, selected: ProviderVirtualDeclarationFact, fact: TsonicRawMemoryOperationFact): void {
  const args = source.ast.arguments(fact.call);
  let expected: string;
  let operands: readonly Node[];
  switch (fact.operation) {
    case "to-raw": expected = "toRawPointer"; operands = [fact.pointerExpression, fact.layoutExpression]; break;
    case "reinterpret": expected = "reinterpretRawPointer"; operands = [fact.rawExpression, fact.layoutExpression]; break;
    case "byte-offset": expected = "offsetRawPointer"; operands = [fact.rawExpression, fact.offsetExpression, fact.dataLayoutExpression]; break;
    case "raw-to-address-integer": expected = "rawPointerToAddressInteger"; operands = [fact.rawExpression, fact.dataLayoutExpression]; break;
    case "address-integer-to-raw": expected = "addressIntegerToRawPointer"; operands = [fact.addressExpression, fact.dataLayoutExpression]; break;
  }
  if (selected.exportId !== expected || args.length !== operands.length || operands.some((operand, index) => args[index] !== operand)) {
    throw new PointerLoweringError("raw-memory fact disagrees with its selected declaration or exact operand identities");
  }
  const semantics = source.semantics.forNode(fact.call);
  const call = semantics.operations.call(fact.call);
  if (call === undefined || !semantics.types.isIdentical(fact.resultType, call.sourceResultType)) {
    throw new PointerLoweringError("raw-memory fact disagrees with its exact selected result type");
  }
}
