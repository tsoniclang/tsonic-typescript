import { pointerOperationFactKey } from "@tsonic/tsts";
import type { Node, PointerOperationFact, SourceFile } from "@tsonic/tsts";
import type { TargetSourceProgram } from "@tsonic/target-api/source";
import {
  createTsonicClosedArrayStorageQueries,
  createTsonicPointerBackingQueries,
  selectTsonicRawLocationOperation,
} from "@tsonic/source-core/facts";
import type { TargetProgramIndex } from "../../program-index.js";
import { PointerLoweringError } from "../diagnostic.js";
import { leafMemoryLayout } from "./layout.js";
import type { ScalarMemoryLayout } from "./layout.js";
import { memoryABIKey } from "./identity.js";

export interface MemoryArrayPlan {
  owns(source: TargetSourceProgram): boolean;
  validate(file: SourceFile): void;
  layoutForAddress(node: Node): ScalarMemoryLayout | undefined;
}

export function createMemoryArrayPlan(source: TargetSourceProgram, program: TargetProgramIndex): MemoryArrayPlan {
  const layouts = new Map<Node, ScalarMemoryLayout>();
  const failures = new Map<SourceFile, string[]>();
  const addresses = new Map<Node, Extract<PointerOperationFact, { operation: "address-of" }>>();
  for (const node of program.nodes) {
    const operation = source.sourceFacts.getFact(node, pointerOperationFactKey);
    if (operation?.operation === "address-of" && operation.call === node) addresses.set(operation.storageExpression, operation);
  }
  const arrays = createTsonicClosedArrayStorageQueries(source, 131_072);
  const pointers = createTsonicPointerBackingQueries(source, {
    maximumValues: 131_072,
    hasClosedCallers: declaration => source.ast.is.IsFunctionDeclaration(declaration) &&
      !source.navigation.declarationUseSummary(declaration).exported,
  });
  for (const node of program.nodes) {
    if (!source.ast.is.IsCallExpression(node)) continue;
    const selected = selectTsonicRawLocationOperation(source.ast, source.sourceFacts, node);
    if (selected?.kind !== "resolved" || selected.operation.operation !== "to-raw") continue;
    const origins = pointers.resolve(selected.expression);
    if (origins.kind !== "origins") continue;
    for (const origin of origins.origins) {
      if (origin.operation !== "address-of" || !source.ast.is.IsElementAccessExpression(origin.storageExpression)) continue;
      try {
        const storage = arrays.resolve(origin.storageExpression);
        if (storage.kind !== "closed") throw new PointerLoweringError(storage.reason);
        if (storage.declarations.some(declaration => source.navigation.declarationUseSummary(declaration).bindingWritten)) {
          throw new PointerLoweringError("raw array storage requires non-reassigned allocation bindings");
        }
        let minimumLength = Infinity;
        for (const literal of storage.literals) minimumLength = Math.min(minimumLength, source.ast.elements(literal).length);
        for (const element of storage.elements) {
          if (element.accessMode === "read") continue;
          const argument = element.argument.expression;
          const index = source.ast.is.IsNumericLiteral(argument) ? Number(source.ast.text(argument)) : NaN;
          if (!Number.isSafeInteger(index) || index < 0 || index >= minimumLength) {
            throw new PointerLoweringError("raw array storage has an element write without a proven in-bounds index");
          }
        }
        const layout = leafMemoryLayout(source, selected.layout);
        if (layout.kind !== "scalar") throw new PointerLoweringError("array byte addressing requires an exact scalar codec, not an identity-only descriptor");
        for (const element of storage.elements) {
          const address = addresses.get(element.expression);
          if (address === undefined) continue;
          if (!source.semantics.forNode(element.expression).types.isNumberLike(element.argument.type)) {
            throw new PointerLoweringError("raw array element address requires an exact numeric index");
          }
          const previous = layouts.get(address.call);
          if (previous !== undefined && !sameLayout(previous, layout)) {
            throw new PointerLoweringError("one array allocation has conflicting selected element layouts");
          }
          layouts.set(address.call, layout);
        }
        if (!layouts.has(origin.call)) throw new PointerLoweringError("raw array origin is absent from the exact allocation address set");
      } catch (error) {
        if (!(error instanceof PointerLoweringError)) throw error;
        const file = source.ast.getSourceFile(node);
        if (file === undefined) throw error;
        const messages = failures.get(file) ?? [];
        messages.push(error.message);
        failures.set(file, messages);
      }
    }
  }
  return Object.freeze({
    owns: (candidate: TargetSourceProgram): boolean => candidate === source,
    layoutForAddress: (node: Node): ScalarMemoryLayout | undefined => layouts.get(node),
    validate(file: SourceFile): void {
      const messages = failures.get(file);
      if (messages !== undefined) throw new PointerLoweringError(messages.join("; "));
    },
  });
}

function sameLayout(left: ScalarMemoryLayout, right: ScalarMemoryLayout): boolean {
  return left.runtimeFactory === right.runtimeFactory && left.fact.byteSize === right.fact.byteSize &&
    left.fact.byteAlignment === right.fact.byteAlignment && left.fact.stride === right.fact.stride &&
    memoryABIKey(left.fact.dataLayout) === memoryABIKey(right.fact.dataLayout);
}
