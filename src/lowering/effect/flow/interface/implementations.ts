import type { Node, Type } from "@tsonic/tsts";
import type {
  SourceFileSemantics,
  TargetSourceProgram,
} from "@tsonic/target-api/source";

import {
  interfaceContractTypeDeclaration,
  isExactInterfaceSourceDeclaration,
} from "./declarations.js";
import {
  type CallableReturnRewrite,
} from "../../model/callable-contract.js";
import {
  callableDeclarationHasExactCallableType,
  callableDeclarationHasResolvableType,
} from "../../model/callable-contract/resolution.js";
import {
  callableUsesSynchronousTransport,
  typeHasTrustedSynchronousCallSignatures,
} from "../../model/synchronous.js";
import {
  nodeHasExactSourceSemantics,
  sourceBodyInspectionIsExact,
  type ExactSourceBodyInspection,
} from "../../model/source-membership.js";
import { storageDeclarationCanBeTracked } from "../storage/owners.js";
import { interfaceImplementationReturnContract } from "./implementation-synchrony.js";

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
  returnRewritesFor(implementation: Node): readonly CallableReturnRewrite[];
  returnContractBlockersFor(implementation: Node): readonly Node[];
}

interface ResolvedImplementation {
  readonly sourceType: Type;
  readonly sourceDeclaration?: Node;
  readonly contract: Node;
  readonly implementation: Node;
  readonly returnRewrites: readonly CallableReturnRewrite[];
  readonly returnContractBlockers: readonly Node[];
}

interface ResolvedCallableImplementation {
  readonly declaration: Node;
  readonly returnRewrites: readonly CallableReturnRewrite[];
  readonly returnContractBlockers: readonly Node[];
}

export function createInterfaceContractImplementationLedger(
  source: TargetSourceProgram,
  linkContracts: (left: Node, right: Node) => void,
  bodyInspectionIsCertified?: ExactSourceBodyInspection,
): InterfaceContractImplementationLedger {
  const contractImplementations = new Map<Node, Set<Node>>();
  const typeContracts = new Map<Type, Set<Node>>();
  const declarationContracts = new Map<Node, Set<Node>>();
  const implementationContracts = new Map<Node, Set<Node>>();
  const implementationReturnRewrites = new Map<
    Node,
    Map<Node, CallableReturnRewrite>
  >();
  const implementationReturnContractBlockers = new Map<Node, Set<Node>>();
  const attemptedTypeContracts = new Map<Type, Map<Node, boolean>>();

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
      for (const rewrite of entry.returnRewrites) {
        addReturnRewrite(
          implementationReturnRewrites,
          entry.implementation,
          rewrite,
        );
      }
      for (const blocker of entry.returnContractBlockers) {
        addToSet(
          implementationReturnContractBlockers,
          entry.implementation,
          blocker,
        );
      }
    }
  };

  const record = (
    semantics: SourceFileSemantics,
    sourceType: Type,
    contracts: readonly Node[],
  ): readonly Node[] => {
    const unresolved: Node[] = [];
    for (const contract of contracts) {
      const attempted = attemptedTypeContracts.get(sourceType)?.get(contract);
      if (attempted !== undefined) {
        if (!attempted) {
          unresolved.push(contract);
        }
        continue;
      }
      const resolved = resolveContractImplementations(
        source,
        semantics,
        sourceType,
        contract,
        bodyInspectionIsCertified,
      );
      if (resolved === undefined) {
        recordAttempt(attemptedTypeContracts, sourceType, contract, false);
        unresolved.push(contract);
      } else {
        commit(resolved);
        recordAttempt(attemptedTypeContracts, sourceType, contract, true);
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
      const members = semantics.types.unionOrIntersectionTypes(selected);
      return members.length !== 0 && members.every((member) =>
        member !== undefined && provides(semantics, member, contract)
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
    returnRewritesFor(implementation: Node): readonly CallableReturnRewrite[] {
      return Object.freeze([
        ...(implementationReturnRewrites.get(implementation)?.values() ?? []),
      ]);
    },
    returnContractBlockersFor(implementation: Node): readonly Node[] {
      return Object.freeze([
        ...(implementationReturnContractBlockers.get(implementation) ?? []),
      ]);
    },
  });
}

function resolveContractImplementations(
  source: TargetSourceProgram,
  semantics: SourceFileSemantics,
  sourceType: Type,
  contract: Node,
  bodyInspectionIsCertified?: ExactSourceBodyInspection,
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
        bodyInspectionIsCertified,
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
    bodyInspectionIsCertified,
  );
  if (implementation === undefined) {
    return undefined;
  }
  return [Object.freeze({
    sourceType: selected,
    ...(sourceDeclaration === undefined ? {} : { sourceDeclaration }),
    contract,
    implementation: implementation.declaration,
    returnRewrites: implementation.returnRewrites,
    returnContractBlockers: implementation.returnContractBlockers,
  })];
}

function resolveCallableImplementation(
  source: TargetSourceProgram,
  semantics: SourceFileSemantics,
  sourceType: Type,
  contract: Node,
  bodyInspectionIsCertified?: ExactSourceBodyInspection,
): ResolvedCallableImplementation | undefined {
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
    callableImplementationNode(
      source,
      candidate,
      bodyInspectionIsCertified,
    )
  ).filter(
    (candidate, index, selected): candidate is Node =>
      candidate !== undefined &&
      selected.indexOf(candidate) === index &&
      isExactInterfaceImplementationDeclaration(
        source,
        candidate,
        bodyInspectionIsCertified,
      ),
  );
  if (candidates.length === 1) {
    const implementation = candidates[0]!;
    const returnContract = interfaceImplementationReturnContract(
      source,
      declarations,
      implementation,
      bodyInspectionIsCertified,
    );
    if (returnContract !== undefined) {
      return Object.freeze({
        declaration: implementation,
        returnRewrites: returnContract.rewrites,
        returnContractBlockers: returnContract.blockers,
      });
    }
  }
  const memberType = semantics.types.typeOfSymbol(symbol);
  return declarations.length !== 0 &&
      declarations.every((declaration) =>
        declarationFileSynchronousImplementation(source, declaration)
      ) &&
      memberType !== undefined &&
      typeHasTrustedSynchronousCallSignatures(source, semantics, memberType)
    ? Object.freeze({
        declaration: declarations[0]!,
        returnRewrites: Object.freeze([]),
        returnContractBlockers: Object.freeze([]),
      })
    : undefined;
}

function callableImplementationNode(
  source: TargetSourceProgram,
  declaration: Node,
  bodyInspectionIsCertified?: ExactSourceBodyInspection,
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
  if (
    storageDeclarationCanBeTracked(source, declaration) &&
    sourceBodyInspectionIsExact(
      source,
      declaration,
      bodyInspectionIsCertified,
    ) &&
    (
      callableDeclarationHasResolvableType(source, declaration) ||
      callableDeclarationHasExactCallableType(source, declaration)
    )
  ) {
    return declaration;
  }
  if (
    sourceBodyInspectionIsExact(
      source,
      declaration,
      bodyInspectionIsCertified,
    ) &&
    (source.ast.is.IsPropertyAssignment(declaration) ||
      source.ast.is.IsShorthandPropertyAssignment(declaration))
  ) {
    return declaration;
  }
  return callableUsesSynchronousTransport(
    source,
    declaration,
    bodyInspectionIsCertified,
  )
    ? declaration
    : undefined;
}

function isExactInterfaceImplementationDeclaration(
  source: TargetSourceProgram,
  declaration: Node,
  bodyInspectionIsCertified?: ExactSourceBodyInspection,
): boolean {
  if (
    isExactInterfaceSourceDeclaration(
      source,
      declaration,
      bodyInspectionIsCertified,
    ) ||
    sourceBodyInspectionIsExact(
      source,
      declaration,
      bodyInspectionIsCertified,
    )
  ) {
    return true;
  }
  const sourceFile = source.ast.getSourceFile(declaration);
  return sourceFile !== undefined &&
    source.ast.isDeclarationFile(sourceFile) &&
    callableUsesSynchronousTransport(
      source,
      declaration,
      bodyInspectionIsCertified,
    );
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

function addReturnRewrite(
  target: Map<Node, Map<Node, CallableReturnRewrite>>,
  implementation: Node,
  rewrite: CallableReturnRewrite,
): void {
  let rewrites = target.get(implementation);
  if (rewrites === undefined) {
    rewrites = new Map();
    target.set(implementation, rewrites);
  }
  const existing = rewrites.get(rewrite.target);
  if (
    existing !== undefined &&
    (existing.selection.kind !== rewrite.selection.kind ||
      existing.selection.index !== rewrite.selection.index)
  ) {
    throw new Error("interface implementation has conflicting return rewrites");
  }
  rewrites.set(rewrite.target, rewrite);
}

function recordAttempt(
  attempts: Map<Type, Map<Node, boolean>>,
  type: Type,
  contract: Node,
  resolved: boolean,
): void {
  let contracts = attempts.get(type);
  if (contracts === undefined) {
    contracts = new Map();
    attempts.set(type, contracts);
  }
  contracts.set(contract, resolved);
}
