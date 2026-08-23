import type { Node } from "@tsonic/tsts";

declare const contractSetBrand: unique symbol;

export type InterfaceOriginContractSet = Uint32Array & {
  readonly [contractSetBrand]: true;
};

export interface InterfaceOriginContractDomain {
  readonly contracts: readonly Node[];
  readonly wordCount: number;
  empty(): InterfaceOriginContractSet;
  single(contract: number): InterfaceOriginContractSet;
  has(contracts: InterfaceOriginContractSet, contract: number): boolean;
  isEmpty(contracts: InterfaceOriginContractSet): boolean;
  count(contracts: InterfaceOriginContractSet): number;
  union(
    left: InterfaceOriginContractSet,
    right: InterfaceOriginContractSet,
  ): InterfaceOriginContractSet;
  subtract(
    left: InterfaceOriginContractSet,
    right: InterfaceOriginContractSet,
  ): InterfaceOriginContractSet;
  select(
    active: InterfaceOriginContractSet,
    predicate: (contract: Node, index: number) => boolean,
  ): InterfaceOriginContractSet;
}

export function createInterfaceOriginContractDomain(
  contracts: readonly Node[],
): InterfaceOriginContractDomain {
  const wordCount = Math.ceil(contracts.length / 32);
  const assertContract = (contract: number): void => {
    if (!Number.isInteger(contract) || contract < 0 || contract >= contracts.length) {
      throw new Error("interface origin contract index is outside its domain");
    }
  };
  return Object.freeze({
    contracts,
    wordCount,
    empty(): InterfaceOriginContractSet {
      return contractSet(wordCount);
    },
    single(contract: number): InterfaceOriginContractSet {
      assertContract(contract);
      const result = contractSet(wordCount);
      setContract(result, contract);
      return result;
    },
    has(selected: InterfaceOriginContractSet, contract: number): boolean {
      assertContract(contract);
      return hasContract(selected, contract);
    },
    isEmpty(selected: InterfaceOriginContractSet): boolean {
      for (let word = 0; word < wordCount; word += 1) {
        if ((selected[word] ?? 0) !== 0) {
          return false;
        }
      }
      return true;
    },
    count(selected: InterfaceOriginContractSet): number {
      let count = 0;
      for (let word = 0; word < wordCount; word += 1) {
        count += populationCount(selected[word] ?? 0);
      }
      return count;
    },
    union(
      left: InterfaceOriginContractSet,
      right: InterfaceOriginContractSet,
    ): InterfaceOriginContractSet {
      const result = contractSet(wordCount);
      for (let word = 0; word < wordCount; word += 1) {
        result[word] = (left[word] ?? 0) | (right[word] ?? 0);
      }
      return result;
    },
    subtract(
      left: InterfaceOriginContractSet,
      right: InterfaceOriginContractSet,
    ): InterfaceOriginContractSet {
      const result = contractSet(wordCount);
      for (let word = 0; word < wordCount; word += 1) {
        result[word] = (left[word] ?? 0) & ~(right[word] ?? 0);
      }
      return result;
    },
    select(
      active: InterfaceOriginContractSet,
      predicate: (contract: Node, index: number) => boolean,
    ): InterfaceOriginContractSet {
      const result = contractSet(wordCount);
      for (let index = 0; index < contracts.length; index += 1) {
        const contract = contracts[index];
        if (
          contract !== undefined &&
          hasContract(active, index) &&
          predicate(contract, index)
        ) {
          setContract(result, index);
        }
      }
      return result;
    },
  });
}

export function contractSet(wordCount: number): InterfaceOriginContractSet {
  return new Uint32Array(wordCount) as InterfaceOriginContractSet;
}

export function hasContract(
  contracts: InterfaceOriginContractSet,
  contract: number,
): boolean {
  return ((contracts[contract >>> 5] ?? 0) & (1 << (contract & 31))) !== 0;
}

export function setContract(
  contracts: InterfaceOriginContractSet,
  contract: number,
): void {
  const word = contract >>> 5;
  contracts[word] = (contracts[word] ?? 0) | (1 << (contract & 31));
}

function populationCount(value: number): number {
  let selected = value - ((value >>> 1) & 0x55555555);
  selected = (selected & 0x33333333) + ((selected >>> 2) & 0x33333333);
  return (((selected + (selected >>> 4)) & 0x0f0f0f0f) * 0x01010101) >>> 24;
}
