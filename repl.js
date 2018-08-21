#!/usr/bin/env node

const { EOL } = require("os");
const immutable = require("immutable");
const { namify } = require("./src/utils");
const parse = require("./src/parse");
const check = require("./src/check");
const generate = require("./src/generate");

function castType(to, from) {
  return to.castFrom(from);
}

function readableType({ readable }) {
  return readable;
}

const tAny = {
  type: "any",
  castFrom(other) {
    return true;
  },
  readable: "*"
};

function tPrimitive(type, value) {
  return {
    type,
    value,
    castFrom({ type: otherType, value: otherValue }) {
      return (
        (type === otherType) &&
        (value === undefined || value === otherValue));
    },
    readable: value === undefined ? type : `${type}(${value})`
  };
}

function checkFunctionArgs(args, _args) {
  if (_args.length !== args.length) {
    return false;
  }
  else {
    for (let i = 0; i < _args.length; i++) {
      if (!castType(args[i], _args[i])) {
        return false;
      }
    }
    return true;
  }
}

function staticFunction(args, res) {
  const readableArgs = args.map(readableType);
  const readableRes = readableType(res);
  return {
    type: "function",
    fn(..._args) {
      return checkFunctionArgs(args, _args) && res;
    },
    castFrom({ type: otherType, fn: otherFn }) {
      if (otherType === "function") {
        const otherRes = otherFn(...args);
        return otherRes && castType(res, otherRes);
      }
      else {
        return false;
      }
    },
    readable: `fn(${readableArgs.join(", ")}) -> ${readableRes}`
  };
}

function dynamicFunction(args, resFn) {
  const readableArgs = args.map(readableType);
  const readableRes = "?";
  return {
    type: "function",
    fn(..._args) {
      return checkFunctionArgs(args, _args) && resFn(..._args);
    },
    castFrom({ type: otherType, fn: otherFn }) {
      if (otherType === "function") {
        const res = resFn(...args);
        const otherRes = otherFn(...args);
        return res && otherRes && castType(res, otherRes);
      }
      else {
        return false;
      }
    },
    readable: `fn(${readableArgs.join(", ")}) -> ${readableRes}`
  };
}

function tFunction(...args) {
  const res = args.pop();
  if (typeof res === "function") {
    return dynamicFunction(args, res);
  }
  else {
    return staticFunction(args, res);
  }
};

function tVariant(...types) {
  const readableTypes = types.map(readableType);
  function castFrom({ type: otherType, types: otherTypes }) {
    if (otherType === "variant") {
      for (let _other of otherTypes) {
        if (!castFrom(_other)) {
          return false;
        }
      }
      return true;
    }
    else {
      for (let type of types) {
        if (castType(type, other)) {
          return true;
        }
      }
      return false;
    }
  }
  return {
    type: "variant",
    types,
    castFrom,
    readable: `(${readableTypes.join(" | ")})`
  };
}

function define(name, value, meta) {
  global.monada$meta[name] = meta || {};
  global[namify(name)] = value;
  return value;
}

function getMeta(name) {
  return global.monada$meta[name];
}

function compile(src) {
  const parsed = parse(src);
  const checked = check(parsed);
  const generated = generate(checked);
  return eval(generated);
}

function initEnvironment() {
  global.monada$meta = {};

  define("define", define);
  define("getMeta", getMeta);
  define("compile", compile);

  define("immutable", immutable);

  define("castType", castType);
  define("readableType", readableType);

  define("tAny", tAny);
  define("tUndefined", tPrimitive("undefined"));
  define("tNull", tPrimitive("null"));
  define("tFalse", tPrimitive("false"));
  define("tTrue", tPrimitive("true"));
  define("tBoolean", tVariant(tPrimitive("false"), tPrimitive("true")));
  define("tNumber", tPrimitive("number"));
  define("tString", tPrimitive("string"));
  define("tPrimitive", tPrimitive);

  define("id", (x) => x, {
    type: tFunction(tAny, (x) => x)
  });
  define("+", (a, b) => a + b, {
    type: tFunction(tNumber, tNumber, tNumber)
  })
  define("print", (x) => console.log(x), {
    type: tFunction(tAny, tUndefined)
  });
}

function formatError(e, src) {
  if (e.location) {
    const line = e.location.start.line - 1;
    const column = e.location.start.column;
    return [e.message, src.split(EOL)[line], "^".padStart(column)].join(EOL);
  }
  else {
    return e.stack;
  }
}

function repl(src) {
  try {
    compile(src);
  }
  catch(e) {
    console.log(formatError(e, src));
  }
}

function run() {
  initEnvironment();
  //repl(`print(42)`);
  repl(`print(42 + null)`);
  //repl(`x = 42`);
  //repl(`print(x)`);
  /*repl(`
    let
      x = print(42)
    in
      print(x(x))
    end`);*/
  //repl(`print(id)(print)`);
}

run();
