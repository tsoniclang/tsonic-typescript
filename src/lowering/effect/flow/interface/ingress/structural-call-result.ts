import type { Node, Signature, Type } from "@tsonic/tsts";
import type { SourceFileSemantics } from "@tsonic/target-api/source";

import { sourceValueReference } from "../../../model/exact-source-invocation.js";
import { sourceBodyInspectionIsExact } from "../../../model/source-membership.js";
import { exactUniqueSignaturePairs } from "../type-pair/signatures.js";
import type { InterfaceContractIngress } from "../ingress.js";

export interface ExactStructuralCallResultType {
  readonly semantics: SourceFileSemantics;
  readonly type: Type;
}

export function exactStructuralCallResultTypes(
  expression: Node,
  ingress: InterfaceContractIngress,
): readonly ExactStructuralCallResultType[] | undefined {
  const semantics = ingress.source.semantics.forNode(expression);
  const call = semantics.operations.call(expression);
  const access = call?.sourceCalleeAccess;
  if (
    call === undefined ||
    call.outcome !== "applicable" ||
    call.optionalChain ||
    access?.kind !== "property"
  ) {
    return undefined;
  }
  const receiverReference = sourceValueReference(
    ingress.source,
    access.receiver.expression,
  );
  const receiver = receiverReference?.declaration;
  if (
    receiver === undefined ||
    !ingress.source.ast.is.IsParameterDeclaration(receiver) ||
    !sourceBodyInspectionIsExact(
      ingress.source,
      receiver,
      ingress.bodyInspectionIsCertified,
    ) ||
    !ingress.invocationInputs.isClosed(receiver)
  ) {
    return undefined;
  }
  const inputs = ingress.invocationInputs.inputsFor(receiver);
  const selectedSymbol = access.selectedSymbol ?? access.symbol;
  const selectedName = selectedSymbol === undefined
    ? undefined
    : semantics.declarations.symbolName(selectedSymbol);
  const targetSignatures = semantics.types.callSignatures(access.resultType);
  if (
    inputs === undefined ||
    inputs.length === 0 ||
    selectedName === undefined ||
    selectedName.length === 0 ||
    targetSignatures.length === 0
  ) {
    return undefined;
  }
  const results: ExactStructuralCallResultType[] = [];
  for (const input of inputs) {
    const inputSemantics = ingress.source.semantics.forNode(input);
    const inputType = inputSemantics.types.expressionType(input);
    if (
      inputType === undefined ||
      !collectInputResultTypes(
        inputSemantics,
        inputType,
        selectedName,
        targetSignatures,
        call.selectedSignature,
        ingress,
        results,
      )
    ) {
      return undefined;
    }
  }
  return results.length === 0
    ? undefined
    : Object.freeze([...new Map(results.map((result) => [
        result.type,
        result,
      ])).values()]);
}

function collectInputResultTypes(
  semantics: SourceFileSemantics,
  type: Type,
  selectedName: string,
  targetSignatures: readonly Signature[],
  selectedTarget: Signature,
  ingress: InterfaceContractIngress,
  results: ExactStructuralCallResultType[],
): boolean {
  const selected = semantics.types.withoutMissingOrUndefined(type);
  if (
    selected === undefined ||
    semantics.types.isAny(selected) ||
    semantics.types.isUnknown(selected) ||
    semantics.types.isNever(selected) ||
    semantics.types.couldContainTypeVariables(selected)
  ) {
    return false;
  }
  if (semantics.types.isUnion(selected)) {
    const members = semantics.types.unionOrIntersectionTypes(selected);
    return members.length !== 0 && members.every((member) =>
      member !== undefined && collectInputResultTypes(
        semantics,
        member,
        selectedName,
        targetSignatures,
        selectedTarget,
        ingress,
        results,
      )
    );
  }
  const properties = semantics.types.propertyInfos(selected).filter(
    (property) => property.name === selectedName,
  );
  if (properties.length !== 1) {
    return false;
  }
  const sourceSignatures = semantics.types.callSignatures(properties[0]!.type);
  const pairs = exactUniqueSignaturePairs(
    semantics,
    sourceSignatures,
    targetSignatures,
    ingress.relevance,
  );
  if (pairs === undefined) {
    return false;
  }
  const selectedDeclaration = semantics.declarations.signatureDeclaration(
    selectedTarget,
  );
  const matches = pairs.filter(([, target]) =>
    target === selectedTarget ||
    selectedDeclaration !== undefined &&
      semantics.declarations.signatureDeclaration(target) === selectedDeclaration
  );
  if (matches.length !== 1) {
    return false;
  }
  const result = semantics.types.returnType(matches[0]![0]);
  if (result === undefined) {
    return false;
  }
  results.push(Object.freeze({ semantics, type: result }));
  return true;
}
