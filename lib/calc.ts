/**
 * A small arithmetic evaluator for the `calculate` tool.
 * It parses the expression itself, so nothing from the model is ever run as code.
 * Supports + - * / % ^, parentheses, a few functions, and the constants pi and e.
 */

const FUNCTIONS: Record<string, (...args: number[]) => number> = {
  sqrt: Math.sqrt,
  abs: Math.abs,
  round: (x, places = 0) => Math.round(x * 10 ** places) / 10 ** places,
  floor: Math.floor,
  ceil: Math.ceil,
  ln: Math.log,
  log: Math.log10,
  exp: Math.exp,
  sin: Math.sin,
  cos: Math.cos,
  tan: Math.tan,
  min: Math.min,
  max: Math.max,
  pow: Math.pow,
};

const CONSTANTS: Record<string, number> = { pi: Math.PI, e: Math.E };

export function calculate(expression: string): number {
  const src = expression.replace(/,(?=\d{3}\b)/g, "").replace(/×/g, "*").replace(/÷/g, "/");
  if (src.length > 300) throw new Error("Expression is too long.");
  let pos = 0;

  const peek = () => {
    while (src[pos] === " ") pos++;
    return src[pos];
  };
  const eat = (ch: string) => {
    if (peek() !== ch) throw new Error(`Expected "${ch}" at position ${pos + 1}.`);
    pos++;
  };

  // expr := term (("+" | "-") term)*
  const expr = (): number => {
    let value = term();
    while (peek() === "+" || peek() === "-") {
      const op = src[pos++];
      const right = term();
      value = op === "+" ? value + right : value - right;
    }
    return value;
  };

  // term := unary (("*" | "/" | "%") unary)*
  const term = (): number => {
    let value = unary();
    while (peek() === "*" || peek() === "/" || peek() === "%") {
      const op = src[pos++];
      const right = unary();
      value = op === "*" ? value * right : op === "/" ? value / right : value % right;
    }
    return value;
  };

  // unary := ("-" | "+") unary | power       so -2^2 is -(2^2)
  const unary = (): number => {
    if (peek() === "-") {
      pos++;
      return -unary();
    }
    if (peek() === "+") {
      pos++;
      return unary();
    }
    return power();
  };

  // power := atom ("^" unary)?               right associative: 2^3^2 is 2^(3^2)
  const power = (): number => {
    const base = atom();
    if (peek() === "^") {
      pos++;
      return Math.pow(base, unary());
    }
    return base;
  };

  const atom = (): number => {
    const ch = peek();
    if (ch === "(") {
      pos++;
      const value = expr();
      eat(")");
      return value;
    }
    const number = /^\d+(\.\d+)?([eE][+-]?\d+)?|^\.\d+/.exec(src.slice(pos));
    if (number) {
      pos += number[0].length;
      return Number(number[0]);
    }
    const word = /^[a-zA-Z]+/.exec(src.slice(pos));
    if (word) {
      pos += word[0].length;
      const name = word[0].toLowerCase();
      if (peek() === "(") {
        const fn = Object.hasOwn(FUNCTIONS, name) ? FUNCTIONS[name] : undefined;
        if (!fn) throw new Error(`Unknown function "${name}".`);
        pos++;
        const args: number[] = [];
        if (peek() !== ")") {
          args.push(expr());
          while (peek() === ",") {
            pos++;
            args.push(expr());
          }
        }
        eat(")");
        return fn(...args);
      }
      if (Object.hasOwn(CONSTANTS, name)) return CONSTANTS[name];
      throw new Error(`Unknown name "${name}".`);
    }
    throw new Error(ch === undefined ? "The expression ended early." : `Unexpected "${ch}" at position ${pos + 1}.`);
  };

  const value = expr();
  if (peek() !== undefined) throw new Error(`Unexpected "${peek()}" at position ${pos + 1}.`);
  if (!Number.isFinite(value)) throw new Error("The result is not a finite number.");
  return value;
}
