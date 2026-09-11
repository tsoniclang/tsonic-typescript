import type { Node } from "@tsonic/tsts";
import type { TargetSourceProgram } from "@tsonic/target-api/source";
import type { TsonicMemoryFieldLayoutFact, TsonicMemoryRecordBindingFact } from "@tsonic/source-core/facts";
import type { GeneratedBindingName, SourceFileGeneratedNames } from "../../../generated-names.js";
import { PointerLoweringError } from "../../diagnostic.js";

export interface BoundMemoryField {
  readonly key: string;
  readonly slot: GeneratedBindingName;
  readonly pointer: GeneratedBindingName;
  readonly value: GeneratedBindingName;
}

export interface BoundMemoryRecord {
  readonly fact: TsonicMemoryRecordBindingFact;
  readonly fields: readonly BoundMemoryField[];
  readonly bindings: GeneratedBindingName;
  readonly key: GeneratedBindingName;
}

export function boundMemoryFieldKey(source: TargetSourceProgram, fact: TsonicMemoryFieldLayoutFact): string {
  const semantics = source.semantics.forNode(fact.call);
  const matching = semantics.types.propertyInfos(fact.sourceType).filter(property =>
    property.symbol === fact.selectedSymbol ||
    fact.selectedSymbol !== undefined && property.rootSymbols.includes(fact.selectedSymbol) ||
    semantics.declarations.symbolDeclarations(property.symbol).includes(fact.selectedDeclaration));
  const selected = matching[0];
  if (matching.length !== 1 || selected === undefined || selected.optional || selected.readonly) {
    throw new PointerLoweringError("field binding requires its exact mutable data-property identity");
  }
  return selected.name;
}

export function boundMemoryRecord(source: TargetSourceProgram, names: SourceFileGeneratedNames,
  fact: TsonicMemoryRecordBindingFact): BoundMemoryRecord {
  const declarations = new Set<Node>();
  const fields = fact.fields.map(({ binding }) => {
    if (declarations.has(binding.field.selectedDeclaration)) {
      throw new PointerLoweringError("record binding repeats its selected field declaration");
    }
    declarations.add(binding.field.selectedDeclaration);
    return Object.freeze({ key: boundMemoryFieldKey(source, binding.field),
      slot: names.reserve("fieldBinding"), pointer: names.reserve("fieldLocation"), value: names.reserve("fieldValue") });
  });
  return Object.freeze({ fact, fields: Object.freeze(fields),
    bindings: names.reserve("fieldBindings"), key: names.reserve("fieldKey") });
}
