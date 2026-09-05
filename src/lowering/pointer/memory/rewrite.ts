import type { Node } from "@tsonic/tsts";
import {
  AsCallExpression, AsTypeReferenceNode, NewNumericLiteral, NewStringLiteral,
  NewVoidExpression,
  NewKeywordTypeNode, KindUndefinedKeyword,
} from "@tsonic/tsts/target-ast";
import type { NodeFactory } from "@tsonic/tsts/target-ast";
import type { GeneratedBindingName } from "../../generated-names.js";
import { runtimeCall, runtimeType, requiredRuntimeNode } from "../runtime-ast.js";
import { PointerLoweringError } from "../diagnostic.js";
import type { MemoryRewrite } from "./plan.js";

export function rewriteMemoryNode(factory: NodeFactory, selected: MemoryRewrite, updated: Node, runtimeAlias: GeneratedBindingName): Node {
  if (selected.kind === "abi-type") return requiredRuntimeNode(NewKeywordTypeNode(factory, KindUndefinedKeyword), "erased closed ABI alias type");
  if (selected.kind === "layout-type") {
    const reference = AsTypeReferenceNode(updated);
    const argument = reference?.TypeArguments?.Nodes[0];
    if (reference?.TypeArguments?.Nodes.length !== 1 || argument === undefined) throw new PointerLoweringError("memory layout type lost its exact pointee argument");
    return runtimeType(factory, runtimeAlias, "MemoryLayout", [argument]);
  }
  if (selected.kind === "abi-token") return requiredRuntimeNode(NewVoidExpression(factory, NewNumericLiteral(factory, "0", 0)), "erased certified ABI operand");
  const call = AsCallExpression(updated);
  if (call === undefined) throw new PointerLoweringError("memory operation lost its call node");
  const args = call.Arguments?.Nodes ?? [];
  if (selected.kind === "layout") {
    return runtimeCall(factory, runtimeAlias, selected.layout.runtimeFactory, [], [
      requiredRuntimeNode(NewStringLiteral(factory, selected.layout.fact.dataLayout.byteOrder, 0), "selected byte order"),
      requiredRuntimeNode(NewNumericLiteral(factory, String(selected.layout.fact.byteAlignment), 0), "selected byte alignment"),
      requiredRuntimeNode(NewNumericLiteral(factory, String(selected.layout.fact.stride), 0), "selected byte stride"),
    ]);
  }
  if (selected.kind === "query") return requiredRuntimeNode(NewNumericLiteral(factory, String(selected.value), 0), "exact layout query");
  const first = args[0];
  if (first === undefined) throw new PointerLoweringError("memory operation lost its first operand");
  if (selected.kind === "keep-alive") return requiredRuntimeNode(NewVoidExpression(factory, first), "managed storage lifetime barrier");
  const second = args[1];
  if (second === undefined) throw new PointerLoweringError("memory operation lost its second operand");
  switch (selected.fact.operation) {
    case "to-raw": return runtimeCall(factory, runtimeAlias, "toRawPointer", [], [first, second]);
    case "reinterpret": return runtimeCall(factory, runtimeAlias, "reinterpretRawPointer", [], [first, second]);
    case "byte-offset": return runtimeCall(factory, runtimeAlias, "offsetRawPointer", [], [first, second]);
    default: throw new PointerLoweringError("unrepresentable raw address operation reached emission");
  }
}
