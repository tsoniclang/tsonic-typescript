import { fieldFactKey, structFactKey } from "@tsonic/tsts";
import type { Node } from "@tsonic/tsts";
import { KindPropertySignature } from "@tsonic/tsts/target-ast";
import type { TargetSourceProgram } from "@tsonic/target-api/source";
import { readTsonicMemoryType } from "@tsonic/source-core/facts";
import type { TsonicArrayMemoryLayoutFact, TsonicMemoryFieldLayoutFact, TsonicMemoryLayoutFact, TsonicMemoryTypeIdentity } from "@tsonic/source-core/facts";
import type { GeneratedBindingName, SourceFileGeneratedNames } from "../../generated-names.js";
import { PointerLoweringError } from "../diagnostic.js";
import { leafMemoryLayout } from "./layout.js";
import type { IdentityMemoryLayout, ScalarMemoryLayout } from "./layout.js";
import type { MemoryReferencePlan, ReferenceMemoryLayout } from "./references/plan.js";

export interface RecordMemoryField {
  readonly fact: TsonicMemoryFieldLayoutFact;
  readonly key: string;
  readonly binding: GeneratedBindingName;
  readonly valueBinding: GeneratedBindingName;
}

export interface RecordMemoryLayout {
  readonly kind: "record";
  readonly fact: TsonicMemoryLayoutFact;
  readonly fields: readonly RecordMemoryField[];
  readonly accessBinding: GeneratedBindingName;
}

export interface ArrayAddressMemoryLayout {
  readonly kind: "array-address";
  readonly fact: TsonicArrayMemoryLayoutFact;
}

export type ExecutableMemoryLayout = ScalarMemoryLayout | IdentityMemoryLayout | RecordMemoryLayout | ReferenceMemoryLayout | ArrayAddressMemoryLayout;

export function createExecutableMemoryLayouts(source: TargetSourceProgram, names: SourceFileGeneratedNames, references: MemoryReferencePlan) {
  const layouts = new Map<Node, ExecutableMemoryLayout>();
  const fields = new Map<Node, RecordMemoryField>();

  function field(fact: TsonicMemoryFieldLayoutFact): RecordMemoryField {
    const previous = fields.get(fact.call);
    if (previous !== undefined) return previous;
    const semantics = source.semantics.forNode(fact.call);
    const fieldType = readTsonicMemoryType(source.sourceFacts, fact.call);
    const childType = readTsonicMemoryType(source.sourceFacts, fact.fieldLayout.call);
    if (fieldType === undefined || childType === undefined || fieldType.identity !== childType.identity) {
      throw new PointerLoweringError("record field codec requires its exact shared child memory-type identity");
    }
    const properties = semantics.types.propertyInfos(fact.sourceType);
    const matching = properties.filter(property => property.symbol === fact.selectedSymbol ||
      fact.selectedSymbol !== undefined && property.rootSymbols.includes(fact.selectedSymbol) ||
      semantics.declarations.symbolDeclarations(property.symbol).includes(fact.selectedDeclaration));
    const property = matching[0];
    if (matching.length !== 1 || property === undefined || property.optional || property.readonly ||
        !semantics.types.isIdentical(property.type, fact.fieldType) ||
        !(source.ast.kind(fact.selectedDeclaration) === KindPropertySignature || source.ast.is.IsPropertyDeclaration(fact.selectedDeclaration) ||
          source.ast.is.IsPropertyAssignment(fact.selectedDeclaration) && source.sourceFacts.getFact(fact.selectedDeclaration, fieldFactKey) !== undefined) ||
        source.ast.hasModifierKind(fact.selectedDeclaration, "private") ||
        source.ast.hasModifierKind(fact.selectedDeclaration, "protected") ||
        source.ast.is.IsPrivateIdentifier(source.ast.name(fact.selectedDeclaration))) {
      throw new PointerLoweringError("record memory requires one exact mutable data-property selection per field");
    }
    layout(fact.fieldLayout);
    const result = Object.freeze({ fact, key: property.name,
      binding: names.reserve("fieldLayout"), valueBinding: names.reserve("fieldValue") });
    fields.set(fact.call, result);
    return result;
  }

  function layout(fact: TsonicMemoryLayoutFact, expectedType?: TsonicMemoryTypeIdentity): ExecutableMemoryLayout {
    const memoryType = readTsonicMemoryType(source.sourceFacts, fact.call);
    if (memoryType === undefined || memoryType.sourceType !== fact.sourceType ||
        expectedType !== undefined && memoryType.identity !== expectedType) {
      throw new PointerLoweringError("memory codec requires its exact finalized memory-type, ABI and child-layout contract");
    }
    const previous = layouts.get(fact.call);
    if (previous !== undefined) return previous;
    if (fact.kind === "array") {
      layout(fact.elementLayout);
      const result: ArrayAddressMemoryLayout = Object.freeze({ kind: "array-address", fact });
      layouts.set(fact.call, result);
      return result;
    }
    if (fact.fields.length === 0) {
      const leaf = references.forLayout(fact) ?? leafMemoryLayout(source, fact);
      layouts.set(fact.call, leaf);
      return leaf;
    }
    const semantics = source.semantics.forNode(fact.call);
    const subjects = new Set([...semantics.facts.typeSubjects(fact.sourceType),
      ...(fact.explicitTypeNode === undefined ? [] : semantics.facts.authoredTypeSubjects(fact.explicitTypeNode))]);
    for (const field of fact.fields) {
      const shape = source.ast.parent(field.selectedDeclaration);
      const call = shape === undefined ? undefined : source.ast.parent(shape);
      if (shape !== undefined && source.ast.is.IsObjectLiteralExpression(shape) && call !== undefined &&
          source.ast.is.IsCallExpression(call) && source.ast.arguments(call)[0] === shape) {
        subjects.add(call);
      }
      if (shape !== undefined && source.ast.is.IsTypeLiteralNode(shape) && call !== undefined &&
          source.ast.is.IsVariableDeclaration(call) && source.ast.as.AsVariableDeclaration(call)?.Type === shape) {
        subjects.add(call);
      }
    }
    const schemas = [...subjects].flatMap(subject => {
      const schema = source.sourceFacts.getFact(subject, structFactKey);
      return schema?.valueType === true && schema.fields !== undefined ? [schema] : [];
    });
    if (schemas.length === 0) {
      throw new PointerLoweringError("record memory requires finalized value-record evidence, not an unproven reference-record codec");
    }
    const properties = semantics.types.propertyInfos(fact.sourceType);
    if (semantics.types.indexInfos(fact.sourceType).length !== 0 ||
        semantics.types.callSignatures(fact.sourceType).length !== 0 ||
        semantics.types.constructSignatures(fact.sourceType).length !== 0 ||
        properties.length !== fact.fields.length) {
      throw new PointerLoweringError("record memory requires complete finite data-property coverage");
    }
    const selected = fact.fields.map(field);
    if (new Set(selected.map(entry => entry.key)).size !== properties.length ||
        schemas.some(schema => schema.fields?.length !== selected.length ||
          schema.fields.some(member => member.readonly || !selected.some(entry => entry.key === member.name)))) {
      throw new PointerLoweringError("record memory field set does not exactly match its selected type");
    }
    const result: RecordMemoryLayout = Object.freeze({ kind: "record", fact,
      fields: Object.freeze(selected), accessBinding: names.reserve("memoryAccess") });
    layouts.set(fact.call, result);
    return result;
  }

  return { layout, field };
}
