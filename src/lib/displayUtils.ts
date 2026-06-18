// ==== Subscript digits/letters for log bases ====
const SUB_DIGIT: Record<string, string> = {
  '0': '\u2080', '1': '\u2081', '2': '\u2082', '3': '\u2083', '4': '\u2084',
  '5': '\u2085', '6': '\u2086', '7': '\u2087', '8': '\u2088', '9': '\u2089',
  '.': '\u002E', 'e': '\u2091', 'a': '\u2090', 'o': '\u2092',
  'x': '\u2093', 'h': '\u2095', 'k': '\u2096', 'l': '\u2097',
  'm': '\u2098', 'n': '\u2099', 'p': '\u209A', 's': '\u209B',
};

// ==== Superscript digits/letters for exponents ====
const SUP: Record<string, string> = {
  '0': '\u2070', '1': '\u00B9', '2': '\u00B2', '3': '\u00B3', '4': '\u2074',
  '5': '\u2075', '6': '\u2076', '7': '\u2077', '8': '\u2078', '9': '\u2079',
  '-': '\u207B',
  'x': '\u02E3', 'n': '\u207F', 'a': '\u1D43', 'b': '\u1D47', 'c': '\u1D9C',
  'd': '\u1D48', 'e': '\u1D49', 'f': '\u1DA0', 'g': '\u1D4D', 'h': '\u02B0',
  'i': '\u2071', 'j': '\u02B2', 'k': '\u1D4F', 'l': '\u02E1', 'm': '\u1D50',
  'o': '\u1D52', 'p': '\u1D56', 'r': '\u02B3', 's': '\u02E2', 't': '\u1D57',
  'u': '\u1D58', 'v': '\u1D5B', 'w': '\u02B7', 'y': '\u02B8', 'z': '\u1DBB',
};

function toSuperscript(str: string): string {
  return str.split('').map(ch => SUP[ch] ?? ch).join('');
}

function toSubscript(str: string): string {
  return str.split('').map(ch => SUB_DIGIT[ch] ?? ch).join('');
}

/**
 * Substitute parameter values into the expression.
 */
export function substituteParams(expression: string, params: Record<string, number>): string {
  if (!params || Object.keys(params).length === 0) return expression;
  let s = expression;
  const names = Object.keys(params).sort((a, b) => b.length - a.length);
  for (const name of names) {
    const val = params[name];
    let valStr: string;
    if (Math.abs(val) >= 100 || (Math.abs(val) < 0.001 && val !== 0)) {
      valStr = val.toExponential(1);
    } else if (Number.isInteger(val)) {
      valStr = String(val);
    } else {
      valStr = val.toFixed(2).replace(/\.?0+$/, '');
    }
    s = s.replace(new RegExp(`\\b${name}\\b`, 'g'), valStr);
  }
  return s;
}

/**
 * Format expression for beautiful UI display:
 * 1. Substitute parameter values
 * 2. abs(...) → |...|
 * 3. Remove asterisks
 * 4. Convert exponents ^n to superscript
 * 5. Convert log(x)/log(N) to logₙ(x)
 * 6. theta → θ, sqrt → √, pi → π
 * 7. Fix +- → -
 */
export function displayWithParams(expression: string, params: Record<string, number>): string {
  // Step 1: Substitute parameter values
  let s = substituteParams(expression, params);

  // Step 2: Convert abs(...) to |...|
  while (s.includes('abs(')) {
    s = s.replace(/abs\(([^()]+)\)/g, '|$1|');
    s = s.replace(/abs\(([^()]*\([^()]*\)[^()]*)\)/g, '|$1|');
  }

  // Step 3: Simplify 1* and -1* coefficients (Safari-compatible)
  s = s.replace(/(^|[^0-9.])1\*(?=[a-zA-Z(])/g, '$1');   // 1* → remove
  s = s.replace(/(^|[^0-9.])-1\*(?=[a-zA-Z(])/g, '$1-');  // -1* → -

  // Step 4: Convert log(x)/log(N) to logₙ(x)
  s = s.replace(/log\(([^)]+)\)\s*\/\s*log\(([^)]+)\)/g, (_, inner, base) => {
    return `log${toSubscript(base)}(${inner})`;
  });

  // Step 5: Remove all asterisks
  s = s.replace(/\*/g, '');

  // Step 6: Convert exponents to superscript
  s = s.replace(/\^\(([^)]+)\)/g, (_, inner) => '^(' + toSuperscript(inner) + ')');
  s = s.replace(/\^([a-zA-Z0-9-]+)/g, (_, exp) => toSuperscript(exp));

  // Step 7: Replace math symbols
  s = s.replace(/theta/g, '\u03B8');
  s = s.replace(/sqrt/g, '\u221A');
  s = s.replace(/\bpi\b/g, '\u03C0');

  // Step 8: Fix +0, -0, +-, -- (must be AFTER removing *)
  s = s.replace(/\+0(?!\.)/g, '');        // +0 → ''
  s = s.replace(/\+\-/g, '-');             // +- → -
  s = s.replace(/\+\+/g, '+');
  s = s.replace(/\-\-/g, '+');
  s = s.replace(/\+$/g, '');               // trailing +

  return s;
}

/**
 * Simple display without param substitution.
 */
export function displayExpression(expr: string): string {
  if (!expr) return expr;
  let s = expr;
  while (s.includes('abs(')) {
    s = s.replace(/abs\(([^()]+)\)/g, '|$1|');
    s = s.replace(/abs\(([^()]*\([^()]*\)[^()]*)\)/g, '|$1|');
  }
  // Log base subscript
  s = s.replace(/log\(([^)]+)\)\s*\/\s*log\(([^)]+)\)/g, (_, inner, base) => `log${toSubscript(base)}(${inner})`);
  s = s.replace(/\*/g, '');
  s = s.replace(/\^\(([^)]+)\)/g, (_, inner) => '^(' + toSuperscript(inner) + ')');
  s = s.replace(/\^([a-zA-Z0-9-]+)/g, (_, exp) => toSuperscript(exp));
  s = s.replace(/theta/g, '\u03B8');
  s = s.replace(/sqrt/g, '\u221A');
  s = s.replace(/\bpi\b/g, '\u03C0');
  return s;
}

/**
 * Canvas label with param substitution.
 */
export function labelExpression(expression: string, mode: 'cartesian' | 'polar', params: Record<string, number>): string {
  const prefix = mode === 'polar' ? 'r = ' : 'y = ';
  return prefix + displayWithParams(expression, params);
}

/**
 * Domain variable label.
 */
export function domainVariable(mode: 'cartesian' | 'polar'): string {
  return mode === 'polar' ? '\u03B8' : 'x';
}
