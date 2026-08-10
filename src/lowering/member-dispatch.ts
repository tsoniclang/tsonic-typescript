import type { Node } from "@tsonic/tsts";
import type { TargetSourceProgram } from "@tsonic/target-api";

export function methodDispatchIsClosed(
  source: TargetSourceProgram,
  declaration: Node,
): boolean {
  if (!source.ast.is.IsMethodDeclaration(declaration)) {
    return false;
  }
  if (source.ast.hasModifierKind(declaration, "static")) {
    return true;
  }
  const dispatch = source.navigation.memberDispatch(declaration);
  return dispatch !== undefined &&
    !dispatch.overridesBase &&
    !dispatch.hasDerivedOverride;
}
