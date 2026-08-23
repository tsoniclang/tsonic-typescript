import type { Node, Type } from "@tsonic/tsts";
import type {
  SourceFileSemantics,
  TargetSourceProgram,
} from "@tsonic/target-api/source";

import {
  interfaceContractTypeDeclaration,
  isExactInterfaceProjectDeclaration,
} from "./declarations.js";
import {
  callableUsesSynchronousTransport,
  typeHasTrustedSynchronousCallSignatures,
} from "../../model/synchronous.js";
import { nodeHasExactSourceSemantics } from "../../model/source-membership.js";

export interface InterfaceContractImplementationLedger {
  recordTypeImplementations(
    semantics: SourceFileSemantics,
    sourceType: Type,
    contracts: readonly Node[],
  ): boolean;
  recordDeclaredClass(
    classDeclaration: Node,
    contracts: readonly Node[],
  ): readonly Node[];
  typeProvidesContract(
    semantics: SourceFileSemantics,
    type: Type,
    contract: Node,
  ): boolean;
  implementationsFor(contract: Node): readonly Node[];
}

interface ResolvedImplementation {
  readonly sourceType: Type;
  readonly sourceDeclaration?: Node;
  readonly contract: Node;
  readonly implementation: Node;
}

export function createInterfaceContractImplementationLedger(
  source: TargetSourceProgram,
  linkContracts: (left: Node, right: Node) => void,
): InterfaceContractImplementationLedger {
  const contractImplementations = new Map<Node, Set<Node>>();
  const typeContracts = new Map<Type, Set<Node>>();
  const declarationContracts = new Map<Node, Set<Node>>();
  const implementationContracts = new Map<Node, Set<Node>>();

  const commit = (resolved: readonly ResolvedImplementation[]): void => {
    for (const entry of resolved) {
      addToSet(typeContracts, entry.sourceType, entry.contract);
      if (entry.sourceDeclaration !== undefined) {
        addToSet(
          declarationContracts,
          entry.sourceDeclaration,
          entry.contract,
        );
      }
      addToSet(
        contractImplementations,
        entry.contract,
        entry.implementation,
      );
      const shared = implementationContracts.get(entry.implementation);
      for (const contract of shared ?? []) {
        linkContracts(contract, entry.contract);
      }
      addToSet(
        implementationContracts,
        entry.implementation,
        entry.contract,
      );
    }
  };

  const record = (
    semantics: SourceFileSemantics,
    sourceType: Type,
    contracts: readonly Node[],
  ): readonly Node[] => {
    const unresolved: Node[] = [];
    for (const contract of contracts) {
      const resolved = resolveContractImplementations(
        source,
        semantics,
        sourceType,
        contract,
      );
      if (resolved === undefined) {
        unresolved.push(contract);
      } else {
        commit(resolved);
      }
    }
    return Object.freeze(unresolved);
  };
  const provides = (
    semantics: SourceFileSemantics,
    type: Type,
    contract: Node,
  ): boolean => {
    const selected = semantics.types.withoutMissingOrUndefined(type);
    if (selected === undefined || semantics.types.isNever(selected)) {
      return true;
    }
    if (typeContracts.get(selected)?.has(contract) === true) {
      return true;
    }
    if (semantics.types.isUnion(selected)) {
      const members = semantics.types.unionOrIntersectionTypes(selected).filter(
        (member): member is Type => member !== undefined,
      );
      return members.length !== 0 && members.every((member) =>
        provides(semantics, member, contract)
      );
    }
    const declaration = interfaceContractTypeDeclaration(
      semantics,
      selected,
    );
    return declaration !== undefined &&
      declarationContracts.get(declaration)?.has(contract) === true;
  };

  return Object.freeze({
    recordTypeImplementations(
      semantics: SourceFileSemantics,
      sourceType: Type,
      contracts: readonly Node[],
    ): boolean {
      return record(semantics, sourceType, contracts).length === 0;
    },
    recordDeclaredClass(
      classDeclaration: Node,
      contracts: readonly Node[],
    ): readonly Node[] {
      const name = source.ast.name(classDeclaration);
      const sourceFile = source.ast.getSourceFile(classDeclaration);
      if (
        name === undefined ||
        sourceFile === undefined ||
        !nodeHasExactSourceSemantics(source, classDeclaration)
      ) {
        return Object.freeze([...contracts]);
      }
      const semantics = source.semantics.forFile(sourceFile);
      const symbol = source.navigation.sourceReferenceFor(name)?.symbol;
      const type = symbol === undefined
        ? undefined
        : semantics.types.declaredSymbolType(symbol);
      return type === undefined
        ? Object.freeze([...contracts])
        : record(semantics, type, contracts);
    },
    typeProvidesContract(
      semantics: SourceFileSemantics,
      type: Type,
      contract: Node,
    ): boolean {
      return provides(semantics, type, contract);
    },
    implementationsFor(contract: Node): readonly Node[] {
      return Object.freeze([
        ...(contractImplementations.get(contract) ?? []),
      ]);
    },
  });
}

function resolveContractImplementations(
  source: TargetSourceProgram,
  semantics: SourceFileSemantics,
  sourceType: Type,
  contract: Node,
): readonly ResolvedImplementation[] | undefined {
  const selected = semantics.types.withoutMissingOrUndefined(sourceType);
  if (
    selected === undefined ||
    semantics.types.isNever(selected) ||
    semantics.types.isAny(selected) ||
    semantics.types.isUnknown(selected)
  ) {
    return undefined;
  }
  if (semantics.types.isUnion(selected)) {
    const result: ResolvedImplementation[] = [];
    for (const member of semantics.types.unionOrIntersectionTypes(selected)) {
      if (member === undefined) {
        return undefined;
      }
      const resolved = resolveContractImplementations(
        source,
        semantics,
        member,
        contract,
      );
      if (resolved === undefined) {
        return undefined;
      }
      result.push(...resolved);
    }
    return result;
  }
  const sourceDeclaration = interfaceContractTypeDeclaration(
    semantics,
    selected,
  );
  const implementation = resolveCallableImplementation(
    source,
    semantics,
    selected,
    contract,
  );
  if (implementation === undefined) {
    return undefined;
  }
  return [Object.freeze({
    sourceType: selected,
    ...(sourceDeclaration === undefined ? {} : { sourceDeclaration }),
    contract,
    implementation,
  })];
}

function resolveCallableImplementation(
  source: TargetSourceProgram,
  semantics: SourceFileSemantics,
  sourceType: Type,
  contract: Node,
): Node | undefined {
  const name = source.ast.name(contract);
  if (
    name === undefined ||
    !(
      source.ast.is.IsIdentifier(name) ||
      source.ast.is.IsStringLiteral(name) ||
      source.ast.is.IsNumericLiteral(name)
    )
  ) {
    return undefined;
  }
  const properties = semantics.types.propertyInfos(sourceType).filter(
    (property) => property.name === source.ast.text(name),
  );
  if (properties.length !== 1) {
    return undefined;
  }
  const symbol = properties[0]!.symbol;
  const declarations = [
    semantics.declarations.primarySymbolDeclaration(symbol),
    ...semantics.declarations.symbolDeclarations(symbol),
  ].filter((candidate, index, selected): candidate is Node =>
    candidate !== undefined && selected.indexOf(candidate) === index
  );
  const candidates = declarations.map((candidate) =>
    callableImplementationNode(source, candidate)
  ).filter(
    (candidate, index, selected): candidate is Node =>
      candidate !== undefined &&
      selected.indexOf(candidate) === index &&
      isExactInterfaceImplementationDeclaration(source, candidate),
  );
  if (candidates.length === 1) {
    return candidates[0];
  }
  const memberType = semantics.types.typeOfSymbol(symbol);
  return declarations.length !== 0 &&
      declarations.every((declaration) =>
        declarationFileSynchronousImplementation(source, declaration)
      ) &&
      memberType !== undefined &&
      typeHasTrustedSynchronousCallSignatures(source, semantics, memberType)
    ? declarations[0]
    : undefined;
}

function callableImplementationNode(
  source: TargetSourceProgram,
  declaration: Node,
): Node | undefined {
  if (
    (
      source.ast.is.IsMethodDeclaration(declaration) ||
      source.ast.is.IsFunctionDeclaration(declaration)
    ) &&
    source.ast.body(declaration) !== undefined
  ) {
    return declaration;
  }
  const initializer = source.ast.is.IsPropertyDeclaration(declaration)
    ? source.ast.as.AsPropertyDeclaration(declaration)?.Initializer
    : source.ast.is.IsPropertyAssignment(declaration)
    ? source.ast.as.AsPropertyAssignment(declaration)?.Initializer
    : undefined;
  if (
    initializer !== undefined &&
      (
        source.ast.is.IsArrowFunction(initializer) ||
        source.ast.is.IsFunctionExpression(initializer)
      )
  ) {
    return initializer;
  }
  return callableUsesSynchronousTransport(source, declaration)
    ? declaration
    : undefined;
}

function isExactInterfaceImplementationDeclaration(
  source: TargetSourceProgram,
  declaration: Node,
): boolean {
  if (isExactInterfaceProjectDeclaration(source, declaration)) {
    return true;
  }
  const sourceFile = source.ast.getSourceFile(declaration);
  return sourceFile !== undefined &&
    source.ast.isDeclarationFile(sourceFile) &&
    callableUsesSynchronousTransport(source, declaration);
}

function declarationFileSynchronousImplementation(
  source: TargetSourceProgram,
  declaration: Node,
): boolean {
  const sourceFile = source.ast.getSourceFile(declaration);
  return sourceFile !== undefined &&
    source.ast.isDeclarationFile(sourceFile) &&
    callableUsesSynchronousTransport(source, declaration);
}

function addToSet<Key, Value>(
  map: Map<Key, Set<Value>>,
  key: Key,
  value: Value,
): void {
  const selected = map.get(key);
  if (selected === undefined) {
    map.set(key, new Set([value]));
  } else {
    selected.add(value);
  }
}
