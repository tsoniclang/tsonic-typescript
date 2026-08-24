import type { Node, Type } from "@tsonic/tsts";
import type { SourceFileSemantics } from "@tsonic/target-api/source";

import type { InterfaceContractIngress } from "../ingress.js";
import { interfaceContractTypeDeclaration } from "../declarations.js";
import { originDeclarationIsClosed } from "../origin-declaration.js";
import {
  exactReturnedCall,
  successfulValueExpression,
} from "../../../model/syntax.js";

export interface InterfaceOriginFactMeasurements {
  readonly contractExpansions: number;
  readonly contractQueries: number;
  readonly valueExpansions: number;
  readonly valueQueries: number;
}

export interface InterfaceOriginFacts {
  successfulExpression(value: Node): Node | undefined;
  expressionCannotSupplyImplementation(expression: Node): boolean;
  classValueIsClosed(
    semantics: SourceFileSemantics,
    classType: Type,
    contract: Node,
  ): boolean;
  thisValueIsClosed(expression: Node, contract: Node): boolean;
  valueContainerIsClosed(expression: Node): boolean;
  typeProvidesContract(
    semantics: SourceFileSemantics,
    type: Type,
    contract: Node,
  ): boolean;
  typeHasCertifiedImplementation(
    semantics: SourceFileSemantics,
    type: Type,
    contract: Node,
  ): boolean;
  measurements(): InterfaceOriginFactMeasurements;
}

type ContractResults = Map<Node, boolean>;
type TypeResults = Map<Type, ContractResults>;

export function createInterfaceOriginFacts(
  ingress: InterfaceContractIngress,
): InterfaceOriginFacts {
  const expressions = new Map<Node, Node | null>();
  const incapableExpressions = new Map<Node, boolean>();
  const containerResults = new Map<Node, boolean>();
  const provisionResults = new WeakMap<Node, TypeResults>();
  const implementationResults = new WeakMap<Node, TypeResults>();
  let contractQueries = 0;
  let contractExpansions = 0;
  let valueQueries = 0;
  let valueExpansions = 0;

  const cachedTypeContract = (
    cache: WeakMap<Node, TypeResults>,
    semantics: SourceFileSemantics,
    type: Type,
    contract: Node,
    compute: () => boolean,
  ): boolean => {
    contractQueries += 1;
    let types = cache.get(semantics.sourceFile);
    if (types === undefined) {
      types = new Map();
      cache.set(semantics.sourceFile, types);
    }
    let contracts = types.get(type);
    if (contracts === undefined) {
      contracts = new Map();
      types.set(type, contracts);
    }
    const existing = contracts.get(contract);
    if (existing !== undefined) {
      return existing;
    }
    contractExpansions += 1;
    const result = compute();
    contracts.set(contract, result);
    return result;
  };

  const typeHasCertifiedImplementation = (
    semantics: SourceFileSemantics,
    type: Type,
    contract: Node,
  ): boolean => cachedTypeContract(
    implementationResults,
    semantics,
    type,
    contract,
    () =>
      ingress.implementations.typeProvidesContract(
        semantics,
        type,
        contract,
      ) || ingress.implementations.recordTypeImplementations(
        semantics,
        type,
        [contract],
      ),
  );

  const typeProvidesContract = (
    semantics: SourceFileSemantics,
    type: Type,
    contract: Node,
  ): boolean => cachedTypeContract(
    provisionResults,
    semantics,
    type,
    contract,
    () => ingress.relevance.contracts(semantics, type).includes(contract) ||
      typeHasCertifiedImplementation(semantics, type, contract),
  );

  const valueContainerIsClosed = (expression: Node): boolean => {
    const existing = containerResults.get(expression);
    if (existing !== undefined) {
      return existing;
    }
    const semantics = ingress.source.semantics.forNode(expression);
    const type = semantics.types.expressionType(expression);
    const declaration = type === undefined
      ? undefined
      : interfaceContractTypeDeclaration(semantics, type);
    const result = originDeclarationIsClosed(
      ingress.source,
      declaration,
      ingress.bodyInspectionIsCertified,
    ) &&
      (
        ingress.source.ast.is.IsClassDeclaration(declaration) ||
        ingress.source.ast.is.IsClassExpression(declaration)
      );
    containerResults.set(expression, result);
    return result;
  };

  return Object.freeze({
    successfulExpression(value: Node): Node | undefined {
      valueQueries += 1;
      const existing = expressions.get(value);
      if (existing !== undefined) {
        return existing === null ? undefined : existing;
      }
      valueExpansions += 1;
      let expression = successfulValueExpression(ingress.source, value);
      if (
        expression !== undefined &&
        ingress.source.ast.is.IsSpreadElement(expression)
      ) {
        expression = successfulValueExpression(
          ingress.source,
          ingress.source.ast.as.AsSpreadElement(expression)?.Expression,
        );
      }
      const selected = expression === undefined
        ? undefined
        : exactReturnedCall(ingress.source, expression) ?? expression;
      expressions.set(value, selected ?? null);
      return selected;
    },
    expressionCannotSupplyImplementation(expression: Node): boolean {
      const existing = incapableExpressions.get(expression);
      if (existing !== undefined) {
        return existing;
      }
      const semantics = ingress.source.semantics.forNode(expression);
      const type = semantics.types.expressionType(expression);
      let result = false;
      if (type !== undefined) {
        const selected = semantics.types.withoutMissingOrUndefined(type);
        result = selected === undefined || semantics.types.isNever(selected);
      }
      incapableExpressions.set(expression, result);
      return result;
    },
    classValueIsClosed(
      semantics: SourceFileSemantics,
      classType: Type,
      contract: Node,
    ): boolean {
      return typeProvidesContract(semantics, classType, contract);
    },
    thisValueIsClosed(expression: Node, contract: Node): boolean {
      const semantics = ingress.source.semantics.forNode(expression);
      const type = semantics.types.expressionType(expression);
      return type !== undefined &&
        typeProvidesContract(semantics, type, contract) &&
        valueContainerIsClosed(expression);
    },
    valueContainerIsClosed,
    typeProvidesContract,
    typeHasCertifiedImplementation,
    measurements(): InterfaceOriginFactMeasurements {
      return Object.freeze({
        contractExpansions,
        contractQueries,
        valueExpansions,
        valueQueries,
      });
    },
  });
}
