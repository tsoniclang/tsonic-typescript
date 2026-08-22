import type { Node } from "@tsonic/tsts";
import type {
  SourceBindingWrite,
  TargetSourceProgram,
} from "@tsonic/target-api/source";

export function exactBindingWriteInput(
  source: TargetSourceProgram,
  write: SourceBindingWrite,
): Node | undefined {
  if (
    write.kind !== "assignment" ||
    !source.ast.is.IsBinaryExpression(write.operation) ||
    source.ast.operatorKindName(write.operation) !== "KindEqualsToken"
  ) {
    return undefined;
  }
  const assignment = source.ast.as.AsBinaryExpression(write.operation);
  return assignment?.Left === write.reference ? assignment.Right : undefined;
}
