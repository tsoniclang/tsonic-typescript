import type { Node } from "@tsonic/tsts";
import {
  AsMethodDeclaration,
  AsParameterDeclaration,
  AsTupleTypeNode,
  KindFalseKeyword,
  KindMinusToken,
  KindPlusToken,
  KindTrueKeyword,
  NewArrayLiteralExpression,
  NewBinaryExpression,
  NewIfStatement,
  NewKeywordExpression,
  NewReturnStatement,
  NewToken,
  NodeFactory_NewNodeList,
  NodeFactory_UpdateMethodDeclaration,
  NodeFlagsConst,
} from "@tsonic/tsts/target-ast";
import type { NodeFactory } from "@tsonic/tsts/target-ast";

import type { FinalNodeLookup } from "../../final-nodes.js";
import { PointerLoweringError } from "../diagnostic.js";
import type { DirectEntryMethodPlan, DirectEntryMethodRole } from "./direct-entry-plan.js";
import { canonicalPointerMapEntryType } from "./storage-members-ast.js";
import {
  assignment,
  block,
  call,
  conditional,
  expressionStatement,
  identifier,
  isUndefined,
  numeric,
  objectLiteral,
  property,
  required,
  thisProperty,
  undefinedExpression,
  undefinedType,
  unionType,
  variable,
} from "./storage-builders.js";

export function rewriteDirectEntryMethod(
  factory: NodeFactory,
  updated: Node,
  role: DirectEntryMethodRole,
  plan: DirectEntryMethodPlan,
  finalNodes: FinalNodeLookup,
): Node | undefined {
  if (role === "remove-find") {
    return undefined;
  }
  const method = AsMethodDeclaration(updated);
  if (method === undefined) {
    throw new PointerLoweringError(
      `canonical pointer-map ${role} member lost its method shape`,
    );
  }
  const statements = role === "lookup"
    ? lookupStatements(factory, method, plan)
    : role === "lookup-ok"
    ? lookupOkStatements(factory, method, plan)
    : role === "store"
    ? storeStatements(factory, method, plan, finalNodes)
    : role === "delete"
    ? deleteStatements(factory, plan)
    : keysStatements(factory, plan);
  return required(
    NodeFactory_UpdateMethodDeclaration(
      factory,
      method,
      method.modifiers,
      method.AsteriskToken,
      method.name,
      method.PostfixToken,
      method.TypeParameters,
      method.Parameters,
      method.Type,
      method.FullSignature,
      block(factory, statements),
    ),
    `canonical pointer-map ${role} direct-entry method`,
  );
}

function lookupStatements(
  factory: NodeFactory,
  method: NonNullable<ReturnType<typeof AsMethodDeclaration>>,
  plan: DirectEntryMethodPlan,
): readonly Node[] {
  const keyType = required(
    methodParameterTypes(method, 1)[0],
    "canonical pointer-map lookup key type",
  );
  const valueType = required(method.Type, "canonical pointer-map lookup value type");
  return [
    entryBinding(
      factory,
      plan.lookupEntryName,
      plan.lookupKeyName,
      keyType,
      valueType,
      plan,
    ),
    returnStatement(
      factory,
      copyValue(
        factory,
        conditional(
          factory,
          isUndefined(factory, identifier(factory, plan.lookupEntryName)),
          thisProperty(factory, plan.zeroValueName),
          property(factory, identifier(factory, plan.lookupEntryName), "value"),
        ),
        plan,
      ),
    ),
  ];
}

function lookupOkStatements(
  factory: NodeFactory,
  method: NonNullable<ReturnType<typeof AsMethodDeclaration>>,
  plan: DirectEntryMethodPlan,
): readonly Node[] {
  const keyType = required(
    methodParameterTypes(method, 1)[0],
    "canonical pointer-map lookup-ok key type",
  );
  const tuple = AsTupleTypeNode(method.Type);
  const valueType = tuple?.Elements?.Nodes[0];
  if (valueType === undefined || tuple?.Elements?.Nodes.length !== 2) {
    throw new PointerLoweringError(
      "canonical pointer-map lookup-ok lost its tuple result",
    );
  }
  return [
    entryBinding(
      factory,
      plan.lookupOkEntryName,
      plan.lookupOkKeyName,
      keyType,
      valueType,
      plan,
    ),
    required(
      NewIfStatement(
        factory,
        isUndefined(factory, identifier(factory, plan.lookupOkEntryName)),
        block(factory, [
          returnStatement(factory, arrayLiteral(factory, [
            copyValue(factory, thisProperty(factory, plan.zeroValueName), plan),
            keyword(factory, KindFalseKeyword),
          ])),
        ]),
        undefined,
      ),
      "canonical pointer-map absent lookup-ok",
    ),
    returnStatement(factory, arrayLiteral(factory, [
      copyValue(
        factory,
        property(factory, identifier(factory, plan.lookupOkEntryName), "value"),
        plan,
      ),
      keyword(factory, KindTrueKeyword),
    ])),
  ];
}

function storeStatements(
  factory: NodeFactory,
  method: NonNullable<ReturnType<typeof AsMethodDeclaration>>,
  plan: DirectEntryMethodPlan,
  finalNodes: FinalNodeLookup,
): readonly Node[] {
  const parameterTypes = methodParameterTypes(method, 2);
  const keyType = required(
    parameterTypes[0],
    "canonical pointer-map store key type",
  );
  const valueType = required(
    parameterTypes[1],
    "canonical pointer-map store value type",
  );
  const storageDeclaration = required(
    finalNodes.forOriginal(plan.storeStorageDeclaration),
    "canonical pointer-map direct store storage declaration",
  );
  const nilGuard = required(
    finalNodes.forOriginal(plan.storeNilGuard),
    "canonical pointer-map direct store nil guard",
  );
  const entry = () => identifier(factory, plan.storeEntryName);
  const storage = () => identifier(factory, plan.storeStorageName);
  const key = () => identifier(factory, plan.storeKeyName);
  const value = () => identifier(factory, plan.storeValueName);
  return [
    storageDeclaration,
    nilGuard,
    variable(
      factory,
      NodeFlagsConst,
      plan.storeEntryName,
      unionType(factory, [
        canonicalPointerMapEntryType(factory, keyType, valueType),
        undefinedType(factory),
      ]),
      call(factory, storage(), "get", [key()]),
    ),
    required(
      NewIfStatement(
        factory,
        isUndefined(factory, entry()),
        block(factory, [
          expressionStatement(
            factory,
            call(factory, storage(), "insert", [
              key(),
              objectLiteral(factory, [
                ["key", copyKey(factory, key(), plan)],
                ["value", copyValue(factory, value(), plan)],
              ]),
            ]),
          ),
          expressionStatement(
            factory,
            assignment(
              factory,
              thisProperty(factory, plan.countName),
              arithmetic(
                factory,
                thisProperty(factory, plan.countName),
                KindPlusToken,
                numeric(factory, "1"),
              ),
            ),
          ),
          returnStatement(factory, undefined),
        ]),
        undefined,
      ),
      "canonical pointer-map direct insert branch",
    ),
    expressionStatement(
      factory,
      assignment(
        factory,
        property(factory, entry(), "value"),
        copyValue(factory, value(), plan),
      ),
    ),
  ];
}

function deleteStatements(
  factory: NodeFactory,
  plan: DirectEntryMethodPlan,
): readonly Node[] {
  const storage = () => thisProperty(factory, plan.storageName);
  const key = () => identifier(factory, plan.deleteKeyName);
  return [
    required(
      NewIfStatement(
        factory,
        isUndefined(factory, storage()),
        block(factory, [returnStatement(factory, undefined)]),
        undefined,
      ),
      "canonical pointer-map nil delete",
    ),
    required(
      NewIfStatement(
        factory,
        call(factory, storage(), "delete", [key()]),
        block(factory, [
          expressionStatement(
            factory,
            assignment(
              factory,
              thisProperty(factory, plan.countName),
              arithmetic(
                factory,
                thisProperty(factory, plan.countName),
                KindMinusToken,
                numeric(factory, "1"),
              ),
            ),
          ),
        ]),
        undefined,
      ),
      "canonical pointer-map present delete",
    ),
  ];
}

function keysStatements(
  factory: NodeFactory,
  plan: DirectEntryMethodPlan,
): readonly Node[] {
  const storage = () => thisProperty(factory, plan.storageName);
  return [
    returnStatement(
      factory,
      conditional(
        factory,
        isUndefined(factory, storage()),
        arrayLiteral(factory, []),
        call(factory, storage(), "keys", []),
      ),
    ),
  ];
}

function entryBinding(
  factory: NodeFactory,
  entryName: string,
  keyName: string,
  keyType: Node,
  valueType: Node,
  plan: DirectEntryMethodPlan,
): Node {
  return variable(
    factory,
    NodeFlagsConst,
    entryName,
    unionType(factory, [
      canonicalPointerMapEntryType(factory, keyType, valueType),
      undefinedType(factory),
    ]),
    conditional(
      factory,
      isUndefined(factory, thisProperty(factory, plan.storageName)),
      undefinedExpression(factory),
      call(
        factory,
        thisProperty(factory, plan.storageName),
        "get",
        [identifier(factory, keyName)],
      ),
    ),
  );
}

function methodParameterTypes(
  method: NonNullable<ReturnType<typeof AsMethodDeclaration>>,
  count: number,
): readonly Node[] {
  const parameters = method.Parameters?.Nodes ?? [];
  const types = parameters.map((parameter) => AsParameterDeclaration(parameter)?.Type);
  if (types.length !== count || types.some((type) => type === undefined)) {
    throw new PointerLoweringError(
      `canonical pointer-map method requires ${count} typed parameters`,
    );
  }
  return types as readonly Node[];
}

function copyKey(
  factory: NodeFactory,
  value: Node,
  plan: DirectEntryMethodPlan,
): Node {
  return call(
    factory,
    identifier(factory, plan.className),
    plan.copyKeyName,
    [value],
  );
}

function copyValue(
  factory: NodeFactory,
  value: Node,
  plan: DirectEntryMethodPlan,
): Node {
  return call(
    factory,
    identifier(factory, plan.className),
    plan.copyValueName,
    [value],
  );
}

function arrayLiteral(factory: NodeFactory, elements: readonly Node[]): Node {
  return required(
    NewArrayLiteralExpression(
      factory,
      NodeFactory_NewNodeList(factory, [...elements]),
      false,
    ),
    "canonical pointer-map array literal",
  );
}

function arithmetic(
  factory: NodeFactory,
  left: Node,
  operator: number,
  right: Node,
): Node {
  return required(
    NewBinaryExpression(
      factory,
      undefined,
      left,
      undefined,
      NewToken(factory, operator),
      right,
    ),
    "canonical pointer-map count arithmetic",
  );
}

function returnStatement(
  factory: NodeFactory,
  expression: Node | undefined,
): Node {
  return required(
    NewReturnStatement(factory, expression),
    "canonical pointer-map return statement",
  );
}

function keyword(factory: NodeFactory, kind: number): Node {
  return required(
    NewKeywordExpression(factory, kind),
    "canonical pointer-map keyword expression",
  );
}
