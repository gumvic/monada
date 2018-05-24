const GenerationError = require("./error");

const defaultOptions = require("../defaultOptions");

const BAD_ARITY = "throw new TypeError(\"Arity not supported: \" + arguments.length.toString());";
const LIST = "$ImList";
const MAP = "$ImMap";
const GET = "$get";
const HAS = "$has";
const RECORD = "$Record";
const MONAD = "$Monad";
const SELF = "$self";
const TMP = "$tmp";

class Context {
  constructor(options) {
    this.options = options;
    this.oneOffCount = 0;
  }

  oneOffName() {
    return {
      type: "name",
      name: `${TMP}${this.oneOffCount++}`
    };
  }
}

function lines() {
  return Array.prototype.map.call(arguments, line =>
    line instanceof Array ?
      lines.apply(null, line):
      line).filter(s => !!s).join("\n");
}

function __(str) {
  const indentationLength = 2;
  return str
    .split("\n")
    .map(line => line.padStart(line.length + indentationLength))
    .join("\n");
}

function namify({ name }) {
  return name
    .replace(
      /^(do|if|in|for|let|new|try|var|case|else|enum|eval|null|undefined|this|true|void|with|await|break|catch|class|const|false|super|throw|while|yield|delete|export|import|public|return|static|switch|typeof|default|extends|finally|package|private|continue|debugger|function|arguments|interface|protected|implements|instanceof)$/g,
      function(match) {
        return `$${match}`;
      })
    .replace(
      /[\+\-\*\/\>\<\=\%\!\|\&\^\~\?\.\']/g,
      function(match) {
        switch(match) {
          case "+": return "$plus";
          case "-": return "$dash";
          case "*": return "$star";
          case "/": return "$slash";
          case ">": return "$right";
          case "<": return "$left";
          case "=": return "$equals";
          case "%": return "$percent";
          case "!": return "$bang";
          case "|": return "$pipe";
          case "&": return "$and";
          case "^": return "$caret";
          case "~": return "$tilda";
          case "?": return "$question";
          case ".": return "$dot";
          case "'": return "$quote";
        }
      });
}

function isBuiltInOperator(name, arity) {
  switch(arity) {
    case 1:
    switch(name) {
      case "+":
      case "-":
      case "~":
      case "!":
      return true;
      default:
      return false;
    }
    case 2:
    switch(name) {
      case "+":
      case "-":
      case "*":
      case "/":
      case "%":
      case ">":
      case "<":
      case ">=":
      case "<=":
      case "|":
      case "&":
      case "^":
      case ">>":
      case "<<":
      case ">>>":
      case "||":
      case "&&":
      return true;
      default:
      return false;
    }
  }
}

function genPrimitiveLValue(ast, value, context) {
  return "";
}

function genNameLValue(ast, value, context) {
  const name = namify(ast);
  value = generate(value, context);
  return `const ${name} = ${value};`;
}

function genAliasLValue(ast, value, context) {
  const name = namify(ast.name);
  value = generate(value, context);
  return lines(
    `const ${name} = ${value};`,
    genLValue(ast.lvalue, ast.name, context));
}

function genListDestructLValue({ items }, value, context) {
  function genItem({ key, lvalue }, value, context) {
    key = {
      type: "number",
      value: key.toString()
    }
    value = {
      type: "call",
      callee: {
        type: "name",
        name: GET
      },
      args: [value, key]
    };
    return genLValue(lvalue, value, context);
  }
  if (items.length > 1) {
    // TODO or primitive
    if (value.type === "name") {
      return items
        .map((item, i) =>
          genItem({ key: i, lvalue: item }, value, context));
    }
    else {
      const tmpName = context.oneOffName();
      value = generate(value, context);
      return lines(
        `const ${namify(tmpName)} = ${value};`,
        items
          .map((item, i) =>
            genItem({ key: i, lvalue: item }, tmpName, context)));
    }
  }
  else {
    return genItem({ key: 0, lvalue: items[0] }, value, context);
  }
}

function genMapDestructLValue({ items }, value, context) {
  function genItem({ key, lvalue }, value, context) {
    value = {
      type: "call",
      callee: {
        type: "name",
        name: GET
      },
      args: [value, key]
    };
    return genLValue(lvalue, value, context);
  }
  if (items.length > 1) {
    // TODO or primitive
    if (value.type === "name") {
      return items.map(item => genItem(item, value, context));
    }
    else {
      const tmpName = context.oneOffName();
      value = generate(value, context);
      return lines(
        `const ${namify(tmpName)} = ${value};`,
        items.map(item => genItem(item, tmpName, context)));
    }
  }
  else {
    return genItem(items[0], value, context);
  }
}

function genLValue(ast, value, context) {
  switch(ast.type) {
    case "nil":
    case "number":
    case "string":
    case "key": return genPrimitiveLValue(ast, value, context);
    case "name": return genNameLValue(ast, value, context);
    case "alias": return genAliasLValue(ast, value, context);
    case "listDestruct": return genListDestructLValue(ast, value, context);
    case "mapDestruct": return genMapDestructLValue(ast, value, context);
    default: throw new GenerationError(`Internal error: unknown AST type ${ast.type}.`, ast.location);
  }
}

function genNil(ast, context) {
  return "undefined";
}

function genNumber({ value }, context) {
  return value.toString();
}

function genString({ value }, context) {
  return `"${value}"`;
}

function genKey({ value, location }, context) {
  return `"${namify({ name: value, location: location })}"`;
}

function genName(ast, context) {
  return namify(ast);
}

function genList({ items, location }, context) {
  items = items.map(item => generate(item, context)).join(", ");
  return `${LIST}([${items}])`;
}

function genMap({ items, location }, context) {
  items = items
    .map(({ key, value }) => `[${generate(key, context)}, ${generate(value, context)}]`)
    .join(", ");
  return `${MAP}([${items}])`;
}

function genConstant({ lvalue, value }, context) {
  return genLValue(lvalue, value, context);
}

function pregenFunctionVariant({ name, args, body }, context) {
  const arity = args.length;
  name = name ? `${name}$${arity}` : "";
  const argsList = args
    .map((arg, i) =>
      arg.type === "name" ?
        arg :
        { type: "name", name: `$arg${i}` });
  const initArgs = lines(args
    .map((arg, i) =>
      arg.type === "name" ?
        null :
        genLValue(arg, argsList[i], context)));
  args = argsList.map(arg => generate(arg, context)).join(", ");
  body = lines(
    initArgs,
    `return ${generate(body, context)};`);
  return {
    arity: arity,
    name: name,
    args: args,
    body: body
  };
}

function genFunctionVariant(ast, context) {
  const { name, args, body } = pregenFunctionVariant(ast, context);
  return lines(
    `function ${name}(${args}) {`,
    __(body),
    "}");
}

function genFunction({ name, variants }, context) {
  name = namify(name);
  const functions = variants
    .map(({ args, body }) =>
      genFunctionVariant({ name, args, body }, context));
  const arities = variants.map(({ args }) => {
    const arity = args.length;
    args = args.map((arg, i) => `arguments[${i}]`);
    return lines(
      `case ${arity}:`,
      __(`return ${name}$${arity}(${args.join(", ")});`));
  });
  const badArity = lines(
    "default:",
    __(BAD_ARITY));
  const body = lines(
    "switch(arguments.length) {",
      arities,
      badArity,
    "}");
  return lines(
    functions,
    `function ${name}() {`,
    __(body),
    "}");
}

function genRecord({ name, args }, context) {
  name = namify(name);
  args = args.map(namify);
  const constructorArgs = args.join(", ");
  const factoryArgs = lines(
    "{",
    __(args.map(arg => `${arg}: undefined`).join(",\n")),
    "}");
  const init = args.map(arg => `.set("${arg}", ${arg})`).join("");
  const factory = `const ${name}$Factory = ${RECORD}(${factoryArgs});`;
  const badArity = lines(
    `if(arguments.length !== ${args.length}) {`,
    __(BAD_ARITY),
    "}");
  const constructor = lines(
    `function ${name}(${constructorArgs}) {`,
    __(badArity),
    __(`const ${SELF} = Object.create(${name}.prototype);`),
    __(`${name}$Factory.call(${SELF});`),
    __(`return ${SELF}.withMutations(${SELF} => ${SELF}${init});`),
    `}`);
  const inherit = `${name}.prototype = Object.create(${name}$Factory.prototype);`
  return lines(
    factory,
    constructor,
    inherit);
}

function genDefinition(ast, context) {
  switch(ast.type) {
    case "constant": return genConstant(ast, context);
    case "function": return genFunction(ast, context);
    case "record": return genRecord(ast, context);
    default: throw new GenerationError(`Internal error: unknown AST type ${ast.type}.`, ast.location);
  }
}

function genLambda(ast, context) {
  const { arity, args, body } = pregenFunctionVariant(ast, context);
  const badArity = lines(
    `if(arguments.length !== ${arity}) {`,
    __(BAD_ARITY),
    "}");
  return lines(
    `function(${args}) {`,
    __(badArity),
    __(body),
    "}");
}

function genMonad({ items }, context) {
  function _generate(items, context) {
    if (!items.length) {
      return null;
    }
    else {
      const left = items[0];
      const via = left.via;
      const right = _generate(items.slice(1), context);
      const value = generate(left.value, context);
      if (!right) {
        return value;
      }
      else {
        const next = via ?
          lines(
            "($val) => {",
            __(lines(
              genLValue(via, { type: "name", name: "$val" }, context),
              `return ${right};`)),
            "}"):
          lines(
            "() =>",
            __(right));
        return `${MONAD}(${value}, ${next})`;
      }
    }
  }
  return _generate(items, context);
}

function genCase({ branches, otherwise }, context) {
  function _generate(branches, context) {
    if (!branches.length) {
      return generate(otherwise, context);
    }
    const { condition, value } = branches[0];
    const rest = branches.slice(1);
    const _condition = generate(condition, context);
    const ifTrue = generate(value, context);
    const ifFalse = _generate(rest, context);
    return lines(
      `${_condition} ?`,
      __(`${ifTrue} :`),
      __(`${ifFalse}`));
  }
  return _generate(branches, context);
}

function genPrimitivePattern(ast, value, nextBranch, context) {
  return lines(
    `if(${generate(ast, context)} !== ${generate(value, context)}) {`,
      __(nextBranch),
    "}");
}

function genNamePattern(ast, value, nextBranch, context) {
  return `const ${namify(ast)} = ${generate(value, context)}`;
}

function genAliasPattern({ name, pattern }, value, nextBranch, context) {
  return lines(
    `const ${namify(name)} = ${generate(value, context)}`,
    genPattern(pattern, name, nextBranch, context));
}

function genListDestructPattern({ items }, value, nextBranch, context) {
  function genItem({ key, lvalue }, value, context) {
    key = {
      type: "number",
      value: key.toString()
    }
    const guard = lines(
      `if(!${HAS}(${generate(value, context)}, ${generate(key, context)})) {`,
        __(nextBranch),
      "}");
    value = {
      type: "call",
      callee: {
        type: "name",
        name: GET
      },
      args: [value, key]
    };
    return lines(
      guard,
      genPattern(lvalue, value, nextBranch, context));
  }
  if (items.length > 1) {
    // TODO or primitive
    if (value.type === "name") {
      return items
        .map((item, i) =>
          genItem({ key: i, lvalue: item }, value, context));
    }
    else {
      const tmpName = context.oneOffName();
      value = generate(value, context);
      return lines(
        `const ${namify(tmpName)} = ${value};`,
        items
          .map((item, i) =>
            genItem({ key: i, lvalue: item }, tmpName, context)));
    }
  }
  else {
    return genItem({ key: 0, lvalue: items[0] }, value, context);
  }
}

function genMapDestructPattern({ items }, value, nextBranch, context) {
  function genItem({ key, lvalue }, value, context) {
    const guard = lines(
      `if(!${HAS}(${generate(value, context)}, ${generate(key, context)})) {`,
        __(nextBranch),
      "}");
    value = {
      type: "call",
      callee: {
        type: "name",
        name: GET
      },
      args: [value, key]
    };
    return lines(
      guard,
      genPattern(lvalue, value, nextBranch, context));
  }
  if (items.length > 1) {
    // TODO or primitive
    if (value.type === "name") {
      return items.map(item => genItem(item, value, context));
    }
    else {
      const tmpName = context.oneOffName();
      value = generate(value, context);
      return lines(
        `const ${namify(tmpName)} = ${value};`,
        items.map(item => genItem(item, tmpName, context)));
    }
  }
  else {
    return genItem(items[0], value, context);
  }
}

function genPattern(ast, value, nextBranch, context) {
  switch(ast.type) {
    case "nil":
    case "number":
    case "string":
    case "key": return genPrimitivePattern(ast, value, nextBranch, context);
    case "name": return genNamePattern(ast, value, nextBranch, context);
    case "alias": return genAliasPattern(ast, value, nextBranch, context);
    case "listDestruct": return genListDestructPattern(ast, value, nextBranch, context);
    case "mapDestruct": return genMapDestructPattern(ast, value, nextBranch, context);
    default: throw new GenerationError(`Internal error: unknown AST type ${ast.type}.`, ast.location);
  }
}

function genMatchBranch(name, { patterns, value }, values, nextBranch, context) {
  // TODO assert that patterns and values have the same length
  patterns = lines(patterns
    .map((pattern, i) => genPattern(pattern, values[i], nextBranch, context)));
  return lines(
    `function ${name}() {`,
      __(patterns),
      __(`return ${generate(value, context)};`),
    "}");
}

function genMatch({ values, branches, otherwise }, context) {
  const valuesList = values
    .map((value, i) =>
      value.type === "name" ?
        value :
        { type: "name", name: `$val${i}` });
  const initValues = lines(values
    .map((value, i) =>
      value.type === "name" ?
        null :
        `const $val${i} = ${generate(value, context)}`));
  const branchNames = branches
    .map((_, i) => `$pattern${i}`).concat("$otherwise");
  otherwise = lines(
    "function $otherwise() {",
      __(`return ${generate(otherwise, context)};`),
    "}");
  branches = lines(branches
    .map((branch, i) =>
      genMatchBranch(
        branchNames[i],
        branch,
        valuesList,
        `return ${branchNames[i + 1]}();`,
        context)));
  const match = `${branchNames[0]}();`
  return lines(
    "((() => {",
    __(initValues),
    __(branches),
    __(otherwise),
    __(match),
    "})())");
}

function genScope({ definitions, body }, context) {
  definitions = lines(definitions.map(definition => genDefinition(definition, context)));
  body = generate(body, context);
  return lines(
    "((() => {",
    __(definitions),
    __(`return ${body};`),
    "})())");
}

function genCall(ast, context) {
  const { callee, args } = ast;
  if (callee.type === "name" &&
      isBuiltInOperator(callee.name, args.length)) {
    return genOperatorCall(ast, context);
  }
  else {
    return genFunctionCall(ast, context);
  }
}

function genOperatorCall({ callee: { name }, args }, context) {
  if (args.length === 1) {
    const left = generate(args[0], context);
    return `${name}${left}`;
  }
  else if (args.length === 2) {
    const left = generate(args[0], context);
    const right = generate(args[1], context);
    return `${left} ${name} ${right}`;
  }
}

function genFunctionCall({ callee, args }, context) {
  // TODO wrap in braces values that js won't call
  callee = generate(callee, context);
  args = args.map((arg) => generate(arg, context)).join(", ");
  return `${callee}(${args})`;
}

function genAccess({ object, property }, context) {
  object = generate(object, context);
  property = namify(property);
  return `${object}.${property}`;
}

function genInvoke({ object, method, args }, context) {
  object = generate(object, context);
  method = namify(method);
  args = args.map((arg) => generate(arg, context)).join(", ");
  return `${object}.${method}(${args})`;
}

function genImport({ module, value }, context) {
  if (!module) {
    return "";
  }
  else {
    const alias = namify(module);
    if (value.type === "symbols") {
      value = value.items
        .map(({ key, name }) => ({ key: namify(key), name: namify(name) }))
        .map(({ key, name }) => `const ${name} = ${alias}.${key};`);
    }
    else if (value.type === "symbol") {
      value = namify(value);
    }
    else {
      new GenerationError(`Internal error: unknown AST type ${value.type}.`, value.location);
    }
    return lines(
      `const ${alias} = require("${module.name}");`,
      value);
  }
}

function genEssentials({ options: { essentials } }) {
  return Object.entries({
    list: LIST,
    map: MAP,
    get: GET,
    has: HAS,
    record: RECORD,
    monad: MONAD
  }).map(([k, v]) => `const ${v} = ${essentials[k]};`);
}

function genModuleImports({ imports }, context) {
  return lines(
    imports.map(_import => generate(_import, context)),
    genEssentials(context));
}

function genModuleDefinitions({ definitions }, context) {
  return lines(definitions.map(definition => genDefinition(definition, context)));
}

function genExport({ value }, context) {
  if (value.type === "symbols") {
    const items = value.items
      .map(({ key, name }) => ({ key: namify(key), name: namify(name) }))
      .map(({ key, name }) => `${key}: ${name}`)
      .join(",\n");
    value = lines("{",
    __(items),
    "}");
  }
  else if (value.type === "symbol") {
    value = generate(value);
  }
  else {
    new GenerationError(`Internal error: unknown AST type ${value.type}.`, value.location);
  }
  return `module.exports = ${value};`
}

function genModuleExport({ export: _export }, context) {
  return generate(_export, context);
}

function genModuleMain(ast, { options: { app: { main, run } } }) {
  return `${run}(${main});`;
}

function genApp(ast, context) {
  return lines(
    genModuleImports(ast, context),
    genModuleDefinitions(ast, context),
    genModuleMain(ast, context));
}

function genLib(ast, context) {
  return lines(
    genModuleImports(ast, context),
    genModuleDefinitions(ast, context),
    genModuleExport(ast, context));
}

function genModule(ast, context) {
  if (!ast.export) {
    return genApp(ast, context);
  }
  else {
    return genLib(ast, context);
  }
}

function generate(ast, context) {
  switch (ast.type) {
    case "nil": return genNil(ast, context);
    case "number": return genNumber(ast, context);
    case "string": return genString(ast, context);
    case "key": return genKey(ast, context);
    case "name": return genName(ast, context);
    case "list": return genList(ast, context);
    case "map":  return genMap(ast, context);
    case "lambda": return genLambda(ast, context);
    case "monad": return genMonad(ast, context);
    case "case": return genCase(ast, context);
    case "match": return genMatch(ast, context);
    case "scope": return genScope(ast, context);
    case "call": return genCall(ast, context);
    case "access": return genAccess(ast, context);
    case "invoke": return genInvoke(ast, context);
    case "import": return genImport(ast, context);
    case "export": return genExport(ast, context);
    case "module": return genModule(ast, context);
    default: throw new GenerationError(`Internal error: unknown AST type ${ast.type}.`, ast.location);
  }
}

module.exports = function(ast, options) {
  options = options || defaultOptions;
  return generate(ast, new Context(options));
};
