import type { FunctionEntry, FunctionMode, ViewState, TooltipData } from '@/types';
import { create, all } from 'mathjs';

const math = create(all, {});

const COLORS = ['#4f46e5', '#f59e0b', '#10b981', '#ef4444', '#8b5cf6', '#ec4899'];

export function getFunctionColor(index: number): string {
  return COLORS[index % COLORS.length];
}

/** Get the first unused color from the palette. If all are used, cycle. */
export function getNextUnusedColor(usedColors: string[]): string {
  for (const c of COLORS) {
    if (!usedColors.includes(c)) return c;
  }
  // All colors used — cycle based on count
  return COLORS[usedColors.length % COLORS.length];
}

// ==== BUILT-IN IDENTIFIERS ====
const MATH_BUILTINS = new Set([
  'sin', 'cos', 'tan', 'asin', 'acos', 'atan', 'atan2',
  'sinh', 'cosh', 'tanh', 'asinh', 'acosh', 'atanh',
  'sec', 'csc', 'cot',
  'log', 'log10', 'log2', 'ln', 'sqrt', 'cbrt', 'exp', 'abs', 'pow',
  'round', 'floor', 'ceil', 'fix', 'mod', 'factorial', 'gamma',
  'max', 'min', 'mean', 'median', 'sign', 'deg', 'rad',
  'e', 'pi', 'x', 'theta', 't',
]);

const FUNC_NAMES_SORTED = Array.from(MATH_BUILTINS)
  .filter(n => n.length > 1 && !['pi', 'e', 'x', 't', 'theta', 'atan2'].includes(n))
  .sort((a, b) => b.length - a.length);

const NAMES_TO_PROTECT = [...FUNC_NAMES_SORTED, 'theta'];
const PH = '\uE000';

// ==== IMPLICIT MULTIPLICATION ====
export function preprocessExpression(expr: string): string {
  if (!expr || !expr.trim()) return expr;
  let s = expr.trim();

  // Step 1: Space-separated tokens → insert *
  const tokens = s.split(/ +/);
  let r = '';
  for (let i = 0; i < tokens.length; i++) {
    r += tokens[i];
    if (i < tokens.length - 1) {
      const a = tokens[i][tokens[i].length - 1];
      const b = tokens[i + 1][0];
      if (/[\w\)]/.test(a) && /[\w(]/.test(b)) r += '*';
    }
  }
  s = r;

  // Step 2: funcName + variable/digit (no parens)
  for (const fn of FUNC_NAMES_SORTED) {
    // funcName + digit + x/theta → funcName(digit*x)  e.g. sin2x → sin(2*x)
    s = s.replace(new RegExp(`(^|[^a-zA-Z])${fn}(\\d+)(x|theta)(?!\\()`, 'g'), `$1${fn}($2*$3)`);
    // funcName + digit → funcName(digit)  e.g. sin2 → sin(2)
    s = s.replace(new RegExp(`(^|[^a-zA-Z])${fn}(\\d+)(?!\\()`, 'g'), `$1${fn}($2)`);
    // funcName + letter → funcName(letter)  e.g. sinx → sin(x)
    s = s.replace(new RegExp(`(^|[^a-zA-Z])${fn}([a-zA-Z])(?!\\()`, 'g'), `$1${fn}($2)`);
  }

  // Step 3: Insert * BEFORE protecting function names (CRITICAL FIX)
  // digit+letter/( and )+token must happen while function names are still readable
  s = s.replace(/(\d)([a-zA-Z(])/g, '$1*$2');         // 2sin → 2*sin, 3x → 3*x
  s = s.replace(/(\))([a-zA-Z0-9(])/g, '$1*$2');       // )sin → )*sin, )3 → )*3

  // Step 4: Protect function names & theta
  const protectedNames: string[] = [];
  for (const name of NAMES_TO_PROTECT) {
    // Safari-compatible: no lookbehind
    s = s.replace(new RegExp(`(^|[^a-zA-Z])${name}([^a-zA-Z]|$)`, 'g'), (_m, before, after) => {
      const idx = protectedNames.length;
      protectedNames.push(name);
      return before + `${PH}${idx}${PH}` + after;
    });
  }

  // Step 5-6: Insert * in patterns that are SAFE after protection
  s = s.replace(/([a-zA-Z]+)(\()/g, '$1*$2');           // var+(  (non-func vars only)
  s = s.replace(/([a-zA-Z])([a-zA-Z])/g, '$1*$2');      // letter+letter (ax → a*x)

  // Step 7: Restore protected names
  s = s.replace(new RegExp(`${PH}(-?\\d+)${PH}`, 'g'), (_, idx) => protectedNames[parseInt(idx)] || '');

  // Step 8: Clean up
  s = s.replace(/\*+/g, '*');
  s = s.replace(/\*\)/g, ')');
  s = s.replace(/\(\*/g, '(');
  s = s.replace(/\*$/, '');

  return s;
}

// ==== MODE DETECTION ====
export function detectMode(expression: string): FunctionMode {
  const trimmed = expression.trim();
  if (trimmed.startsWith('r=') || trimmed.startsWith('r =')) return 'polar';
  return 'cartesian';
}

export function getExpressionBody(expression: string, mode: FunctionMode): string {
  const trimmed = expression.trim();
  if (mode === 'polar') {
    if (trimmed.startsWith('r=')) return trimmed.slice(2).trim();
    if (trimmed.startsWith('r =')) return trimmed.slice(3).trim();
    return trimmed;
  }
  if (trimmed.startsWith('y=')) return trimmed.slice(2).trim();
  if (trimmed.startsWith('y =')) return trimmed.slice(3).trim();
  return trimmed;
}

// ==== PARAMETER EXTRACTION ====
export function extractParams(expression: string): string[] {
  if (!expression || !expression.trim()) return [];
  const mode = detectMode(expression);
  const body = getExpressionBody(expression, mode);
  const preprocessed = preprocessExpression(body);
  try {
    const node = math.parse(preprocessed);
    const symbols: Set<string> = new Set();
    node.traverse((n: any) => {
      if (n.isSymbolNode && !MATH_BUILTINS.has(n.name.toLowerCase())) symbols.add(n.name);
    });
    return Array.from(symbols);
  } catch { return []; }
}

// ==== AUTO-CONVERT NUMBERS TO PARAMS ====
/**
 * Convert standalone numbers to parameter names.
 * Strategy: preprocess first (inserts * between tokens), then scan for
 * standalone numbers and replace with param names. NO placeholder protection.
 * e.g. "3sin2x" → preprocess → "3*sin(2)*x" → "a*sin(b)*x" with {a:3, b:2}
 */
export function convertNumbersToParams(expression: string): { expression: string; params: Record<string, number> } | null {
  if (!expression || !expression.trim()) return null;

  const existing = extractParams(expression);
  if (existing.length > 0) return null;

  // Step 1: Preprocess — this inserts * between tokens (3sin → 3*sin)
  const preprocessed = preprocessExpression(expression);

  // Step 2: Find standalone numbers in preprocessed expression
  const matches: { start: number; end: number; value: number }[] = [];
  for (let i = 0; i < preprocessed.length; ) {
    const numMatch = preprocessed.slice(i).match(/^(\d+\.?\d*)/);
    if (numMatch) {
      const prev = i > 0 ? preprocessed[i - 1] : '';
      const afterIdx = i + numMatch[1].length;
      const next = afterIdx < preprocessed.length ? preprocessed[afterIdx] : '';
      // Standalone: surrounded by operators, parens, or string boundaries — NOT letters
      if (!/[a-zA-Z]/.test(prev) && !/[a-zA-Z]/.test(next)) {
        matches.push({ start: i, end: afterIdx, value: parseFloat(numMatch[1]) });
      }
      i += numMatch[1].length;
    } else {
      i++;
    }
  }

  if (matches.length === 0) return null;

  // Step 3: Replace numbers with param names (left-to-right: a, b, c...)
  const paramNames = ['a', 'b', 'c', 'd', 'e', 'f'];
  const params: Record<string, number> = {};
  let result = preprocessed;
  let offset = 0;

  for (let i = 0; i < matches.length; i++) {
    const m = matches[i];
    const adjStart = m.start + offset;
    const adjEnd = m.end + offset;
    const name = paramNames[i] || `p${i}`;
    params[name] = m.value;
    result = result.slice(0, adjStart) + name + result.slice(adjEnd);
    offset += name.length - (m.end - m.start);
  }

  // Step 4: Verify the new expression compiles
  try {
    math.parse(result).compile();
  } catch { return null; }

  return { expression: result, params };
}

// ==== CONVERT NUMBERS EVEN WHEN PARAMS EXIST ====
/**
 * Convert standalone numbers to new parameters, keeping existing ones.
 * Same strategy: preprocess first, then scan and replace numbers.
 * e.g. "2cos(3x)+c" → "a*cos(b*x)+c" with existing c preserved
 */
export function convertNumbersWithExisting(
  expression: string,
  existingParamNames: string[]
): { expression: string; params: Record<string, number> } | null {
  if (!expression || !expression.trim()) return null;

  // Step 1: Preprocess
  const preprocessed = preprocessExpression(expression);

  // Step 2: Find standalone numbers
  const matches: { start: number; end: number; value: number }[] = [];
  for (let i = 0; i < preprocessed.length; ) {
    const numMatch = preprocessed.slice(i).match(/^(\d+\.?\d*)/);
    if (numMatch) {
      const prev = i > 0 ? preprocessed[i - 1] : '';
      const afterIdx = i + numMatch[1].length;
      const next = afterIdx < preprocessed.length ? preprocessed[afterIdx] : '';
      if (!/[a-zA-Z]/.test(prev) && !/[a-zA-Z]/.test(next)) {
        matches.push({ start: i, end: afterIdx, value: parseFloat(numMatch[1]) });
      }
      i += numMatch[1].length;
    } else {
      i++;
    }
  }

  if (matches.length === 0) return null;

  // Step 3: Replace numbers with new param names (skip existing names)
  const paramNames = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'];
  const usedNames = new Set(existingParamNames);
  const params: Record<string, number> = {};
  let result = preprocessed;
  let offset = 0;
  let pIdx = 0;

  for (const m of matches) {
    const adjStart = m.start + offset;
    const adjEnd = m.end + offset;

    // Find next available param name
    let name = '';
    while (pIdx < paramNames.length) {
      const candidate = paramNames[pIdx++];
      if (!usedNames.has(candidate)) {
        name = candidate;
        break;
      }
    }
    if (!name) name = `p${pIdx}`;

    params[name] = m.value;
    usedNames.add(name);
    result = result.slice(0, adjStart) + name + result.slice(adjEnd);
    offset += name.length - (m.end - m.start);
  }

  // Step 4: Verify
  try {
    math.parse(result).compile();
  } catch { return null; }

  return { expression: result, params };
}

// ==== COMPILATION ====
export function compileExpression(expression: string, mode?: FunctionMode): any | null {
  if (!expression || !expression.trim()) return null;
  const detectedMode = mode || detectMode(expression);
  const body = getExpressionBody(expression, detectedMode);
  const preprocessed = preprocessExpression(body);
  try { return math.parse(preprocessed).compile(); } catch { return null; }
}

// ==== DOMAIN PARSING ====
function parseDomainValue(val: string): number | null {
  if (!val || !val.trim()) return null;
  try {
    const result = math.evaluate(val);
    if (typeof result === 'number' && isFinite(result)) return result;
    return null;
  } catch { return null; }
}

// ==== EVALUATION ====
export function evaluateCartesian(compiled: any, x: number, params: Record<string, number>): number | null {
  try {
    const scope: Record<string, number> = { x, e: Math.E, pi: Math.PI, ...params };
    const result = compiled.evaluate(scope);
    if (typeof result !== 'number' || !isFinite(result)) return null;
    if (Math.abs(result) > 1e6) return null;
    return result;
  } catch { return null; }
}

export function evaluatePolar(compiled: any, theta: number, params: Record<string, number>): number | null {
  try {
    const scope: Record<string, number> = { theta, t: theta, e: Math.E, pi: Math.PI, ...params };
    const result = compiled.evaluate(scope);
    if (typeof result !== 'number' || !isFinite(result)) return null;
    if (Math.abs(result) > 1e6) return null;
    return result;
  } catch { return null; }
}

// ==== COORDINATE CONVERSION ====
function mathToCanvas(mx: number, my: number, cw: number, ch: number, view: ViewState): [number, number] {
  const up = 40 * view.scale;
  return [cw / 2 + view.offsetX + mx * up, ch / 2 + view.offsetY - my * up];
}

export function canvasToMath(cx: number, cy: number, cw: number, ch: number, view: ViewState): [number, number] {
  const up = 40 * view.scale;
  return [(cx - cw / 2 - view.offsetX) / up, (ch / 2 + view.offsetY - cy) / up];
}

// Extend CanvasRenderingContext2D with roundRect (modern browsers support it)
declare global {
  interface CanvasRenderingContext2D {
    roundRect(x: number, y: number, w: number, h: number, radii: number | number[]): CanvasRenderingContext2D;
  }
}

// ==== GRID ====
const PI = Math.PI;

/** Get grid step based on pixel density (for integer axis) */
function getGridStep(up: number): number {
  if (up > 160) return 0.25;
  if (up > 80) return 0.5;
  if (up < 1.5) return 20;
  if (up < 3) return 10;
  if (up < 6) return 5;
  if (up < 12) return 2;
  return 1;
}

/** Get π-based grid step for x-axis */
function getPiStep(up: number): number {
  if (up < 15) return 2 * PI;
  if (up < 30) return PI;
  if (up < 60) return PI / 2;
  return PI / 4;
}

/** Parse a value into π fraction parts for vertical fraction rendering */
function getPiFraction(val: number): { num: string; den: string } | null {
  const absVal = Math.abs(val);
  const halfPiMult = Math.round(absVal / (PI / 2));
  if (Math.abs(absVal - halfPiMult * PI / 2) > 0.001) return null;
  if (halfPiMult === 0) return null;
  if (halfPiMult % 2 === 0) return null; // nπ, draw inline
  // odd multiple: π/2, 3π/2, 5π/2...
  const n = halfPiMult;
  return { num: n === 1 ? 'π' : `${n}π`, den: '2' };
}

/** Draw a vertical fraction (numerator over denominator with a bar) at (x, y) */
function drawFraction(ctx: CanvasRenderingContext2D, x: number, y: number, num: string, den: string) {
  ctx.save();
  const fs = 10;
  ctx.font = `${fs}px ui-monospace, "Cascadia Code", "Source Code Pro", monospace`;
  const numW = ctx.measureText(num).width;
  const denW = ctx.measureText(den).width;
  const barW = Math.max(numW, denW, 12);

  ctx.fillStyle = '#6c6c6c';
  ctx.textAlign = 'center';

  // Numerator
  ctx.textBaseline = 'bottom';
  ctx.fillText(num, x, y - 3);

  // Fraction bar
  ctx.strokeStyle = '#6c6c6c';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(x - barW / 2, y);
  ctx.lineTo(x + barW / 2, y);
  ctx.stroke();

  // Denominator
  ctx.textBaseline = 'top';
  ctx.fillText(den, x, y + 2);
  ctx.restore();
}

/** Draw x-axis label: inline for nπ, vertical fraction for nπ/2 */
function drawXAxisLabel(ctx: CanvasRenderingContext2D, val: number, x: number, y: number) {
  const absVal = Math.abs(val);
  if (absVal < 0.0001) return;

  // Check if it's an odd multiple of π/2 → draw as vertical fraction
  const frac = getPiFraction(val);
  if (frac) {
    // Offset fraction downward so it doesn't overlap the x-axis
    drawFraction(ctx, x, y + 10, frac.num, frac.den);
    return;
  }

  // Inline: nπ
  const halfPiMult = Math.round(absVal / (PI / 2));
  if (halfPiMult % 2 === 0) {
    const n = halfPiMult / 2;
    const label = n === 1 ? 'π' : (n === -1 ? '-π' : `${n}π`);
    ctx.fillStyle = '#6c6c6c';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.fillText(label, x, y);
    return;
  }

  // Fallback
  ctx.fillStyle = '#6c6c6c';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  ctx.fillText(val.toFixed(2), x, y);
}

export function drawGrid(ctx: CanvasRenderingContext2D, w: number, h: number, view: ViewState) {
  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, w, h);

  const up = 40 * view.scale;
  const cx = w / 2 + view.offsetX;
  const cy = h / 2 + view.offsetY;
  const piMode = view.piMode ?? false;

  // Separate steps: x-axis may use π, y-axis always uses integer
  const gsX = piMode ? getPiStep(up) : getGridStep(up);
  const gsY = getGridStep(up);

  // --- Grid lines ---
  ctx.strokeStyle = '#f0f0f0';
  ctx.lineWidth = 1;
  ctx.beginPath();
  // Vertical lines (x-axis grid)
  const sgx = Math.floor((-cx) / (up * gsX)) * gsX;
  const egx = Math.ceil((w - cx) / (up * gsX)) * gsX;
  for (let g = sgx; g <= egx; g += gsX) {
    const px = cx + g * up;
    if (Math.abs(g) > 0.0001) { ctx.moveTo(px, 0); ctx.lineTo(px, h); }
  }
  // Horizontal lines (y-axis grid, always integer)
  const sgy = Math.floor((cy - h) / (up * gsY)) * gsY;
  const egy = Math.ceil(cy / (up * gsY)) * gsY;
  for (let g = sgy; g <= egy; g += gsY) {
    const py = cy - g * up;
    if (Math.abs(g) > 0.0001) { ctx.moveTo(0, py); ctx.lineTo(w, py); }
  }
  ctx.stroke();

  // --- Axes ---
  ctx.strokeStyle = '#000000';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(0, cy); ctx.lineTo(w, cy);
  ctx.moveTo(cx, 0); ctx.lineTo(cx, h);
  ctx.stroke();

  // Arrowheads
  ctx.fillStyle = '#000000';
  ctx.beginPath();
  ctx.moveTo(w - 8, cy - 4); ctx.lineTo(w, cy); ctx.lineTo(w - 8, cy + 4);
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(cx - 4, 8); ctx.lineTo(cx, 0); ctx.lineTo(cx + 4, 8);
  ctx.fill();

  // --- Axis labels ---
  // X-axis labels (π mode or integer)
  for (let g = sgx; g <= egx; g += gsX) {
    if (Math.abs(g) < 0.0001) continue;
    const px = cx + g * up;
    if (px < 10 || px > w - 10) continue;
    if (piMode) {
      drawXAxisLabel(ctx, g, px, Math.min(cy + 6, h - 22));
    } else {
      ctx.fillStyle = '#6c6c6c';
      ctx.font = '11px ui-monospace, "Cascadia Code", "Source Code Pro", monospace';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';
      ctx.fillText(Math.abs(g) >= 1 ? String(g) : g.toString(), px, Math.min(cy + 6, h - 16));
    }
  }

  // Y-axis labels (always integer, never π)
  ctx.fillStyle = '#6c6c6c';
  ctx.font = '11px ui-monospace, "Cascadia Code", "Source Code Pro", monospace';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  for (let g = sgy; g <= egy; g += gsY) {
    if (Math.abs(g) < 0.0001) continue;
    const py = cy - g * up;
    if (py < 10 || py > h - 10) continue;
    ctx.fillText(Math.abs(g) >= 1 ? String(g) : g.toString(), Math.min(cx + 6, w - 30), py);
  }

  // Origin label
  if (cx > 5 && cx < w - 5 && cy > 5 && cy < h - 5) {
    ctx.fillStyle = '#6c6c6c';
    ctx.font = '11px ui-monospace, "Cascadia Code", "Source Code Pro", monospace';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.fillText('0', cx + 4, cy + 8);
  }
}

// ==== CARTESIAN with domain ====
/** Draw vertical asymptote as dashed line — high visibility */
function drawVerticalAsymptote(ctx: CanvasRenderingContext2D, x: number, color: string, h: number) {
  ctx.save();
  ctx.strokeStyle = color;
  ctx.globalAlpha = 0.85;
  ctx.setLineDash([10, 5]);
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(x, 0);
  ctx.lineTo(x, h);
  ctx.stroke();
  ctx.restore();
}

/** Draw horizontal asymptote — same style as vertical asymptote */
function drawHorizontalAsymptote(ctx: CanvasRenderingContext2D, y: number, color: string, w: number, _dVal: number) {
  ctx.save();
  ctx.strokeStyle = color;
  ctx.globalAlpha = 0.85;
  ctx.setLineDash([10, 5]);
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(0, y);
  ctx.lineTo(w, y);
  ctx.stroke();
  ctx.restore();
}

export function drawCartesianFunction(ctx: CanvasRenderingContext2D, entry: FunctionEntry, w: number, h: number, view: ViewState) {
  if (!entry.visible || !entry.expression.trim()) return;
  const compiled = compileExpression(entry.expression, 'cartesian');
  if (!compiled) return;

  const up = 40 * view.scale;
  const cx = w / 2 + view.offsetX;
  const cy = h / 2 + view.offsetY;

  // Default visible range with margin
  const marginX = 2 / up;
  let minX = (-cx) / up - marginX;
  let maxX = (w - cx) / up + marginX;

  // Apply domain restrictions
  const dMin = parseDomainValue(entry.domainMin);
  const dMax = parseDomainValue(entry.domainMax);
  if (dMin !== null) minX = Math.max(minX, dMin);
  if (dMax !== null) maxX = Math.min(maxX, dMax);
  if (minX >= maxX) return;

  const n = Math.min(8000, Math.max(w * 4, 2000));
  const step = (maxX - minX) / n;

  // Scan for vertical asymptotes:
  // 1. defined ↔ undefined boundaries (log, sqrt, etc.)
  // 2. Extreme y-value jumps (tan, cot, sec, csc, etc.)
  // Exclude: sinh, cosh (no asymptotes, monotonic growth)
  const exprLower = entry.expression.toLowerCase();
  const isSinhCosh = exprLower.includes('sinh(') || exprLower.includes('cosh(');
  const asymptoteXs: number[] = [];

  // Skip vertical asymptote detection for:
  // - sinh, cosh: monotonic, no asymptotes
  // - exponential ^: no vertical asymptotes, but extreme y values cause false detection
  if (entry.showAsymptotes && !isSinhCosh && !exprLower.includes('^')) {
    let prevVal: number | null = null;
    let prevPy: number | null = null;
    for (let i = 0; i <= n; i++) {
      const mx = minX + i * step;
      const yVal = evaluateCartesian(compiled, mx, entry.params);

      // Method 1: defined ↔ undefined boundary (domain-limited functions)
      if (prevVal !== null && yVal !== null) {
        // Both defined — check method 2
      } else if ((prevVal === null) !== (yVal === null)) {
        // Boundary jump — skip if at domain edge (i=0 or i=n)
        if (i > 0 && i < n) {
          const asymX = cx + mx * up;
          if (asymX > 0 && asymX < w) asymptoteXs.push(asymX);
        }
        prevVal = yVal;
        prevPy = null;
        continue;
      }

      // Method 2: extreme y jump (trig functions like tan, cot)
      if (yVal !== null) {
        const py = cy - yVal * up;
        if (prevPy !== null) {
          const jump = Math.abs(py - prevPy);
          if (jump > h * 1.5 && up * step < 100) {
            const px = cx + mx * up;
            const prevPx = cx + (minX + (i - 1) * step) * up;
            const asymX = (prevPx + px) / 2;
            if (asymX > 0 && asymX < w) asymptoteXs.push(asymX);
          }
        }
        prevPy = py;
      } else {
        prevPy = null;
      }
      prevVal = yVal;
    }

    // De-duplicate: cluster nearby asymptotes and take median of each cluster
    // Threshold 30px handles zoomed views where same asymptote spans multiple pixels
    const clusters: number[][] = [];
    for (const x of asymptoteXs.sort((a, b) => a - b)) {
      if (clusters.length === 0 || x - clusters[clusters.length - 1][clusters[clusters.length - 1].length - 1] > 30) {
        clusters.push([x]);
      } else {
        clusters[clusters.length - 1].push(x);
      }
    }
    const deduped = clusters.map(c => c[Math.floor(c.length / 2)]);
    for (const vX of deduped) {
      drawVerticalAsymptote(ctx, vX, entry.color, h);
    }
  }

  // Horizontal asymptotes — only for functions that actually have them
  if (entry.showAsymptotes) {
    const p = entry.params;

    // 1. Exponential: a^(bx+c) + d → y = d (NOT x^2 polynomials!)
    //    Distinguish: base^exponent where base is NOT x
    //    e.g. 2^x, e^(x), a^(2x) have horizontal asymptotes
    //    x^2, x^(3) do NOT have horizontal asymptotes
    const hasExpAsymptote =
      exprLower.match(/[a-wyz0-9]\^\s*\(/) ||  // a^(x), 2^(x) — NOT x^(2)
      exprLower.match(/\d+\^/) ||                // 2^x, 10^x
      exprLower.match(/\be\^/);                  // e^x

    // 2. Rational: a/(bx+c) + d → y = d
    // Match: /x, /(x, /(2.8x, /(bx, etc. — any denominator containing x
    const hasRationalAsymptote = exprLower.includes('/x') || exprLower.match(/\/\([^)]*x/);

    if ((hasExpAsymptote || hasRationalAsymptote) && p.d !== undefined) {
      const hCanvas = cy - p.d * up;
      if (hCanvas > 0 && hCanvas < h) {
        drawHorizontalAsymptote(ctx, hCanvas, entry.color, w, p.d);
      }
    }

    // 3. tanh: a*tanh(b*x) + d → y = d ± a
    if (exprLower.includes('tanh(') && p.a !== undefined && p.d !== undefined) {
      const aVal = Math.abs(p.a);
      const upperY = cy - (p.d + aVal) * up;
      if (upperY > 0 && upperY < h) {
        drawHorizontalAsymptote(ctx, upperY, entry.color, w, p.d + aVal);
      }
      const lowerY = cy - (p.d - aVal) * up;
      if (lowerY > 0 && lowerY < h) {
        drawHorizontalAsymptote(ctx, lowerY, entry.color, w, p.d - aVal);
      }
    }

    // 4. arctan: a*atan(b*x+c) + d → y = d ± a*π/2
    if (exprLower.includes('atan(') && p.a !== undefined && p.d !== undefined) {
      const aVal = Math.abs(p.a) * Math.PI / 2;
      const upperY = cy - (p.d + aVal) * up;
      if (upperY > 0 && upperY < h) {
        drawHorizontalAsymptote(ctx, upperY, entry.color, w, p.d + aVal);
      }
      const lowerY = cy - (p.d - aVal) * up;
      if (lowerY > 0 && lowerY < h) {
        drawHorizontalAsymptote(ctx, lowerY, entry.color, w, p.d - aVal);
      }
    }
  }

  ctx.strokeStyle = entry.color;
  ctx.lineWidth = 2.5;
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';

  ctx.beginPath();
  let prevY: number | null = null;
  let hasPt = false;

  for (let i = 0; i <= n; i++) {
    const mx = minX + i * step;
    const yVal = evaluateCartesian(compiled, mx, entry.params);
    if (yVal === null) { prevY = null; continue; }

    const px = cx + mx * up;
    const py = cy - yVal * up;

    if (prevY !== null) {
      const jump = Math.abs(py - prevY);
      if (jump > h * 1.5 && up * step < 100) {
        prevY = py;
        hasPt = false;
        continue;
      }
    }
    if (py >= -h && py <= h * 2) {
      if (!hasPt) { ctx.moveTo(px, py); hasPt = true; } else { ctx.lineTo(px, py); }
    } else { hasPt = false; }
    prevY = py;
  }
  ctx.stroke();
}

// ==== POLAR with domain ====
export function drawPolarFunction(ctx: CanvasRenderingContext2D, entry: FunctionEntry, w: number, h: number, view: ViewState) {
  if (!entry.visible || !entry.expression.trim()) return;
  const compiled = compileExpression(entry.expression, 'polar');
  if (!compiled) return;

  const up = 40 * view.scale;
  const cx = w / 2 + view.offsetX;
  const cy = h / 2 + view.offsetY;

  // Parse domain
  let thetaMin = 0;
  let thetaMax = 4 * Math.PI;
  const dMin = parseDomainValue(entry.domainMin);
  const dMax = parseDomainValue(entry.domainMax);
  if (dMin !== null) thetaMin = dMin;
  if (dMax !== null) thetaMax = dMax;

  const n = 8000;
  const dTheta = (thetaMax - thetaMin) / n;

  ctx.strokeStyle = entry.color;
  ctx.lineWidth = 2.5;
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';

  ctx.beginPath();
  let prevX: number | null = null, prevY: number | null = null;
  let hasPt = false;

  for (let i = 0; i <= n; i++) {
    const theta = thetaMin + i * dTheta;
    const r = evaluatePolar(compiled, theta, entry.params);
    if (r === null) { prevX = null; prevY = null; continue; }

    const mx = r * Math.cos(theta);
    const my = r * Math.sin(theta);
    const px = cx + mx * up;
    const py = cy - my * up;

    if (prevX !== null && prevY !== null) {
      const dx = Math.abs(px - prevX);
      const dy = Math.abs(py - prevY);
      if (dx > w * 0.8 || dy > h * 0.8) { prevX = px; prevY = py; hasPt = false; continue; }
    }
    if (px >= -w * 0.5 && px <= w * 1.5 && py >= -h * 0.5 && py <= h * 1.5) {
      if (!hasPt) { ctx.moveTo(px, py); hasPt = true; } else { ctx.lineTo(px, py); }
    } else { hasPt = false; }
    prevX = px; prevY = py;
  }
  ctx.stroke();
}

export function drawFunction(ctx: CanvasRenderingContext2D, entry: FunctionEntry, w: number, h: number, view: ViewState) {
  if (entry.mode === 'polar') drawPolarFunction(ctx, entry, w, h, view);
  else drawCartesianFunction(ctx, entry, w, h, view);
}

// ==== LABELS ====
function findLabelPos(compiled: any, entry: FunctionEntry, w: number, h: number, view: ViewState, li: number): { cx: number; cy: number; ok: boolean } {
  const up = 40 * view.scale;
  const cx0 = w / 2 + view.offsetX;
  const cy0 = h / 2 + view.offsetY;
  const off = li * 24;

  if (entry.mode === 'polar') {
    // For polar: sample at fixed theta values to find a point on the curve
    // that lies within the visible canvas area
    const thetas = [Math.PI / 4, Math.PI / 2, Math.PI / 6, Math.PI / 3, Math.PI, 3 * Math.PI / 4];
    for (const theta of thetas) {
      const r = evaluatePolar(compiled, theta, entry.params);
      if (r === null) continue;
      const mx = r * Math.cos(theta);
      const my = r * Math.sin(theta);
      const px = cx0 + mx * up;
      const py = cy0 - my * up;
      if (px > 10 && px < w - 140 && py > 20 + off && py < h - 20) {
        return { cx: px, cy: py - off, ok: true };
      }
    }
    return { cx: w - 130, cy: 30 + li * 24, ok: true };
  }

  // Cartesian: scan along x-axis at fractional positions
  const rx = (w - cx0) / up, lx = (-cx0) / up;
  for (const f of [0.85, 0.7, 0.5, 0.3, 0.15]) {
    const tx = lx + (rx - lx) * f;
    const yv = evaluateCartesian(compiled, tx, entry.params);
    if (yv === null) continue;
    const px = cx0 + tx * up;
    const py = cy0 - yv * up;
    if (px > 10 && px < w - 140 && py > 20 + off && py < h - 20) return { cx: px, cy: py - off, ok: true };
  }
  return { cx: w - 130, cy: 30 + li * 24, ok: true };
}

// Subscript digits for Canvas log labels
const C_SUB: Record<string, string> = {
  '0': '\u2080', '1': '\u2081', '2': '\u2082', '3': '\u2083', '4': '\u2084',
  '5': '\u2085', '6': '\u2086', '7': '\u2087', '8': '\u2088', '9': '\u2089',
  '.': '\u002E',
};

function toSubCanvas(str: string): string {
  return str.split('').map(ch => C_SUB[ch] ?? ch).join('');
}

function drawFuncLabel(ctx: CanvasRenderingContext2D, entry: FunctionEntry, w: number, h: number, view: ViewState, li: number, placedLabels: { top: number; bottom: number }[]) {
  if (!entry.visible || !entry.expression.trim()) return;
  const compiled = compileExpression(entry.expression, entry.mode);
  if (!compiled) return;
  const pos = findLabelPos(compiled, entry, w, h, view, li);
  if (!pos.ok) return;

  const prefix = entry.mode === 'polar' ? 'r = ' : 'y = ';
  let display = entry.expression;

  // Substitute param values
  const paramNames = Object.keys(entry.params).sort((a, b) => b.length - a.length);
  for (const name of paramNames) {
    const val = entry.params[name];
    let valStr: string;
    if (Number.isInteger(val)) valStr = String(val);
    else valStr = val.toFixed(2).replace(/\.?0+$/, '');
    display = display.replace(new RegExp(`\\b${name}\\b`, 'g'), valStr);
  }

  // abs → || (BEFORE 1* removal, so 1* inside abs() can be cleaned)
  while (display.includes('abs(')) {
    display = display.replace(/abs\(([^()]+)\)/g, '|$1|');
    display = display.replace(/abs\(([^()]*\([^()]*\)[^()]*)\)/g, '|$1|');
  }

  // 1* and -1* removal (after abs, so |1*x| → |x|)
  display = display.replace(/(^|[^0-9.])1\*(?=[a-zA-Z(])/g, '$1');
  display = display.replace(/(^|[^0-9.])-1\*(?=[a-zA-Z(])/g, '$1-');

  // Remove *
  display = display.replace(/\*/g, '');

  // Omit standalone coefficient 1: 1sin → sin, 1cos → cos, 1tan → tan, etc.
  display = display.replace(/(^|[^a-zA-Z0-9.])1(?=[a-zA-Z(])/g, '$1');

  // Reciprocal trig: N/sin → Ncosec, etc. (any coefficient, no *)
  display = display.replace(/([a-zA-Z]|\d+\.?\d*)\/sin\(/g, '$1cosec(');
  display = display.replace(/([a-zA-Z]|\d+\.?\d*)\/cos\(/g, '$1sec(');
  display = display.replace(/([a-zA-Z]|\d+\.?\d*)\/tan\(/g, '$1cot(');

  // Omit coefficient 1 for reciprocal trig
  display = display.replace(/(^|[^a-zA-Z0-9.])1cosec\(/g, '$1cosec(');
  display = display.replace(/(^|[^a-zA-Z0-9.])1sec\(/g, '$1sec(');
  display = display.replace(/(^|[^a-zA-Z0-9.])1cot\(/g, '$1cot(');

  // Log base subscript: log(x)/log(10) → log₁₀(x)
  display = display.replace(/log\(([^)]+)\)\s*\/\s*log\(([^)]+)\)/g, (_, inner, base) => {
    return `log${toSubCanvas(base)}(${inner})`;
  });

  // Convert ^digit to Unicode superscript BEFORE zero-cleanup, so ^ won't interact with +- signs
  const SUP: Record<string, string> = { '0': '\u2070', '1': '\u00B9', '2': '\u00B2', '3': '\u00B3', '4': '\u2074', '5': '\u2075', '6': '\u2076', '7': '\u2077', '8': '\u2078', '9': '\u2079' };
  display = display.replace(/\^([0-9])/g, (_, digit) => SUP[digit] || _);

  // Zero-coefficient cleanup (loop until stable)
  let prev: string;
  do {
    prev = display;
    // Remove +0 inside parens: (x+0) → (x)
    display = display.replace(/\(x\+0\)/g, '(x)');
    display = display.replace(/\(0\+x\)/g, '(x)');
    // Remove redundant single-variable parens: (x) → x
    display = display.replace(/\(x\)/g, 'x');
    display = display.replace(/\+0x(?=[+-]|\)|$)/g, '');
    display = display.replace(/-0x(?=[+-]|\)|$)/g, '');
    display = display.replace(/\+0(?=[+-]|\)|$)/g, '');
    display = display.replace(/-0(?=[+-]|\)|$)/g, '');
    display = display.replace(/\+\+/g, '+');
    display = display.replace(/\+-/g, '-');
    display = display.replace(/--/g, '+');
    display = display.replace(/-\+/g, '-');
    display = display.replace(/^\+/g, '');
  } while (display !== prev);

  // Inverse trig full names
  display = display.replace(/asin/g, 'arcsin').replace(/acos/g, 'arccos').replace(/atan/g, 'arctan');
  display = display.replace(/theta/g, '\u03B8').replace(/sqrt/g, '\u221A');
  const label = prefix + display;

  // ==== Styled label with colored accent bar ====
  ctx.font = '13px ui-monospace, "SF Mono", "Menlo", "Cascadia Code", monospace';
  const tm = ctx.measureText(label);
  const padX = 10;
  const barW = 3;
  const lw = tm.width + padX * 2 + barW;
  const lh = 26;
  let rx = Math.min(pos.cx, w - lw - 14);
  rx = Math.max(10, rx);

  // Compute label y position: offset from curve, avoid overlapping other labels
  const minGap = 6;   // gap between labels
  const yOffset = 36; // distance from curve
  let bestCy = pos.cy;
  let bestScore = -Infinity;

  // Try multiple candidate positions and pick the best
  const candidates: number[] = [];
  // Above the curve
  if (pos.cy - yOffset - lh / 2 > 10) candidates.push(pos.cy - yOffset);
  if (pos.cy - yOffset * 1.5 - lh / 2 > 10) candidates.push(pos.cy - yOffset * 1.5);
  if (pos.cy - yOffset * 2 - lh / 2 > 10) candidates.push(pos.cy - yOffset * 2);
  // Below the curve
  if (pos.cy + yOffset + lh / 2 < h - 10) candidates.push(pos.cy + yOffset);
  if (pos.cy + yOffset * 1.5 + lh / 2 < h - 10) candidates.push(pos.cy + yOffset * 1.5);
  if (pos.cy + yOffset * 2 + lh / 2 < h - 10) candidates.push(pos.cy + yOffset * 2);
  // Fallbacks
  if (candidates.length === 0) {
    if (pos.cy > h / 2) candidates.push(10 + lh / 2);
    else candidates.push(h - 10 - lh / 2);
  }

  for (const candidateCy of candidates) {
    const candidateRy = candidateCy - lh / 2;
    // Check overlap with already-placed labels
    let overlapPenalty = 0;
    for (const other of placedLabels) {
      if (candidateRy < other.bottom + minGap && candidateRy + lh > other.top - minGap) {
        const overlap = Math.min(candidateRy + lh, other.bottom) - Math.max(candidateRy, other.top);
        overlapPenalty += overlap + 100; // heavy penalty for overlap
      }
    }
    // Prefer positions closer to the curve (more readable)
    const distFromCurve = Math.abs(candidateCy - pos.cy);
    const score = -distFromCurve - overlapPenalty;
    if (score > bestScore) {
      bestScore = score;
      bestCy = candidateCy;
    }
  }

  const labelCy = bestCy;
  const ry = labelCy - lh / 2;

  // Record this label's position for subsequent labels
  placedLabels.push({ top: ry, bottom: ry + lh });

  // Shadow
  ctx.fillStyle = 'rgba(0,0,0,0.08)';
  ctx.beginPath();
  ctx.roundRect(rx + 1, ry + 2, lw, lh, 6);
  ctx.fill();

  // White background
  ctx.fillStyle = 'rgba(255,255,255,0.96)';
  ctx.beginPath();
  ctx.roundRect(rx, ry, lw, lh, 6);
  ctx.fill();

  // Subtle border
  ctx.strokeStyle = 'rgba(0,0,0,0.06)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.roundRect(rx + 0.5, ry + 0.5, lw - 1, lh - 1, 6);
  ctx.stroke();

  // Colored accent bar on left
  ctx.fillStyle = entry.color;
  ctx.beginPath();
  const cornerR = 6;
  ctx.moveTo(rx + cornerR, ry);
  ctx.arcTo(rx, ry, rx, ry + cornerR, cornerR);
  ctx.lineTo(rx, ry + lh - cornerR);
  ctx.arcTo(rx, ry + lh, rx + cornerR, ry + lh, cornerR);
  ctx.lineTo(rx + barW, ry + lh);
  ctx.lineTo(rx + barW, ry);
  ctx.closePath();
  ctx.fill();

  // Label text
  ctx.fillStyle = '#1a1a1a';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillText(label, rx + barW + padX, labelCy + 0.5);
}

export function drawFunctionLabels(ctx: CanvasRenderingContext2D, functions: FunctionEntry[], w: number, h: number, view: ViewState) {
  const placedLabels: { top: number; bottom: number }[] = [];
  let idx = 0;
  for (const e of functions) {
    if (!e.visible || !e.expression.trim()) continue;
    drawFuncLabel(ctx, e, w, h, view, idx, placedLabels);
    idx++;
  }
}

// ==== HOVER ====
export function findNearestPoint(mx: number, my: number, entries: FunctionEntry[], w: number, h: number, view: ViewState): TooltipData | null {
  const [mathX] = canvasToMath(mx, my, w, h, view);
  let bestEntry: TooltipData | null = null;
  let minDist = Infinity;
  for (const entry of entries) {
    if (!entry.visible || !entry.expression.trim()) continue;
    const compiled = compileExpression(entry.expression, entry.mode);
    if (!compiled) continue;

    // Check domain for cartesian
    if (entry.mode === 'cartesian') {
      const dMin = parseDomainValue(entry.domainMin);
      const dMax = parseDomainValue(entry.domainMax);
      if (dMin !== null && mathX < dMin) continue;
      if (dMax !== null && mathX > dMax) continue;
    }

    if (entry.mode === 'polar') {
      // Polar: sample theta values to find geometrically nearest point on curve
      let bestTheta = 0, bestR = 0, minGeoDist = Infinity;
      for (let i = 0; i <= 200; i++) {
        const theta = (i / 200) * 4 * Math.PI;
        const r = evaluatePolar(compiled, theta, entry.params);
        if (r === null) continue;
        const px = r * Math.cos(theta);
        const py = r * Math.sin(theta);
        const [cx_, cy_] = mathToCanvas(px, py, w, h, view);
        const dx = cx_ - mx;
        const dy = cy_ - my;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist < minGeoDist) { minGeoDist = dist; bestR = r; bestTheta = theta; }
      }
      if (minGeoDist < 50 && minGeoDist < minDist) {
        minDist = minGeoDist;
        const bestX = bestR * Math.cos(bestTheta);
        const bestY = bestR * Math.sin(bestTheta);
        const [cX, cY] = mathToCanvas(bestX, bestY, w, h, view);
        bestEntry = { x: bestTheta, y: bestY, canvasX: cX, canvasY: cY };
      }
      continue;
    }

    // Cartesian: find nearest point along vertical line at mouse x
    const yVal = evaluateCartesian(compiled, mathX, entry.params);
    if (yVal === null) continue;
    const [, canvasY] = mathToCanvas(mathX, yVal, w, h, view);
    const dist = Math.abs(canvasY - my);
    if (dist < minDist && dist < 50) {
      minDist = dist;
      const [cX, cY] = mathToCanvas(mathX, yVal, w, h, view);
      bestEntry = { x: mathX, y: yVal, canvasX: cX, canvasY: cY };
    }
  }
  return bestEntry;
}

export function drawHoverIndicator(ctx: CanvasRenderingContext2D, tooltip: TooltipData, w: number, h: number, view: ViewState) {
  const { canvasX, canvasY } = tooltip;
  const cx0 = w / 2 + view.offsetX;
  const cy0 = h / 2 + view.offsetY;
  const cx = Math.max(0, Math.min(w, canvasX));
  const cy = Math.max(0, Math.min(h, canvasY));

  ctx.strokeStyle = '#d4d4d4';
  ctx.lineWidth = 1;
  ctx.setLineDash([4, 4]);
  ctx.beginPath();
  if (Math.abs(canvasY - cy0) > 1) { ctx.moveTo(cx, canvasY); ctx.lineTo(cx, cy0); }
  if (Math.abs(canvasX - cx0) > 1) { ctx.moveTo(canvasX, cy); ctx.lineTo(cx0, cy); }
  ctx.stroke();
  ctx.setLineDash([]);

  ctx.fillStyle = '#fff';
  ctx.strokeStyle = '#000';
  ctx.lineWidth = 2.5;
  ctx.beginPath();
  ctx.arc(cx, cy, 6, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();

  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(cx - 10, cy); ctx.lineTo(cx + 10, cy);
  ctx.moveTo(cx, cy - 10); ctx.lineTo(cx, cy + 10);
  ctx.stroke();
}
