import type { MemoryRewrite } from "./plan.js";

export function memoryRuntimeImport(rewrite: MemoryRewrite): "none" | "type" | "value" {
  switch (rewrite.kind) {
    case "layout":
    case "field":
    case "raw":
    case "keep-alive":
      return "value";
    case "layout-type":
      return "type";
    case "record-schema":
    case "record-schema-reference":
    case "record-schema-imported-query":
    case "query":
    case "metadata-value":
    case "metadata-type":
    case "abi-type":
    case "abi-token":
      return "none";
    default: {
      const exhaustive: never = rewrite;
      return exhaustive;
    }
  }
}
