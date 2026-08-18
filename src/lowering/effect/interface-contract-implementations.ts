import type { Node, Type } from "@tsonic/tsts";
import type {
  SourceFileSemantics,
  TargetSourceProgram,
} from "@tsonic/target-api";

import {
  interfaceContractTypeDeclaration,
  isExactInterfaceProjectDeclaration,
} from "./interface-contract-declarations.js";

export interface InterfaceContractImplementationLedger {
  recordTypeImplementations(
    semantics: SourceFileSemantics,
    sourceType: Type,
    contracts: readonly Node[],
  ): boolean;
  recordDeclaredClass(
    classDeclaration: Node,
    contracts: readonly Node[],
  ): boolean;
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
  ): boolean => {
    const resolved = resolveImplementations(
      source,
      semantics,
      sourceType,
      contracts,
    );
    if (resolved === undefined) {
      return false;
    }
    commit(resolved);
    return true;
  };
  const provides = (
    semantics: SourceFileSemantics,
    type: Type,
    contract: Node,
  ): boolean => {
    const selected = semantics.removeMissingOrUndefined(type);
    if (selected === undefined || semantics.isNever(selected)) {
      return true;
    }
    if (typeContracts.get(selected)?.has(contract) === true) {
      return true;
    }
    if (semantics.isUnion(selected)) {
      const members = semantics.getUnionOrIntersectionTypes(selected).filter(
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
    recordTypeImplementations: record,
    recordDeclaredClass(
      classDeclaration: Node,
      contracts: readonly Node[],
    ): boolean {
      const name = source.ast.name(classDeclaration);
      const sourceFile = source.ast.getSourceFile(classDeclaration);
      if (
        name === undefined ||
        sourceFile === undefined ||
        !source.semantics.includes(sourceFile)
      ) {
        return false;
      }
      const semantics = source.semantics.forFile(sourceFile);
      const symbol = semantics.getSymbolAtLocation(name);
      const type = symbol === undefined
        ? undefined
        : semantics.getDeclaredTypeOfSymbol(symbol);
      return type !== undefined && record(semantics, type, contracts);
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

function resolveImplementations(
  source: TargetSourceProgram,
  semantics: SourceFileSemantics,
  sourceType: Type,
  contracts: readonly Node[],
): readonly ResolvedImplementation[] | undefined {
  const selected = semantics.removeMissingOrUndefined(sourceType);
  if (
    selected === undefined ||
    semantics.isNever(selected) ||
    semantics.isAny(selected) ||
    semantics.isUnknown(selected)
  ) {
    return undefined;
  }
  if (semantics.isUnion(selected)) {
    const result: ResolvedImplementation[] = [];
    for (const member of semantics.getUnionOrIntersectionTypes(selected)) {
      if (member === undefined) {
        return undefined;
      }
      const resolved = resolveImplementations(
        source,
        semantics,
        member,
        contracts,
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
  const result: ResolvedImplementation[] = [];
  for (const contract of contracts) {
    const implementation = resolveCallableImplementation(
      source,
      semantics,
      selected,
      contract,
    );
    if (implementation === undefined) {
      return undefined;
    }
    result.push({
      sourceType: selected,
      ...(sourceDeclaration === undefined ? {} : { sourceDeclaration }),
      contract,
      implementation,
    });
  }
  return result;
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
  const symbol = semantics.getPropertyOfType(sourceType, source.ast.text(name));
  if (symbol === undefined) {
    return undefined;
  }
  const candidates = [
    semantics.getSymbolValueDeclaration(symbol),
    ...semantics.getSymbolDeclarations(symbol),
  ].filter((candidate, index, selected): candidate is Node =>
    candidate !== undefined && selected.indexOf(candidate) === index
  ).map((candidate) => callableImplementationNode(source, candidate)).filter(
    (candidate, index, selected): candidate is Node =>
      candidate !== undefined &&
      selected.indexOf(candidate) === index &&
      isExactInterfaceProjectDeclaration(source, candidate),
  );
  return candidates.length === 1 ? candidates[0] : undefined;
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
  return initializer !== undefined &&
      (
        source.ast.is.IsArrowFunction(initializer) ||
        source.ast.is.IsFunctionExpression(initializer)
      )
    ? initializer
    : undefined;
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
