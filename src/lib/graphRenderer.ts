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
  .filter(n => n.length > 1 && !['pi', 'e', 'x', 't', 'theta'].includes(n))
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

// ==== GRID ====
export function drawGrid(ctx: CanvasRenderingContext2D, w: number, h: number, view: ViewState) {
  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, w, h);

  const up = 40 * view.scale;
  const cx = w / 2 + view.offsetX;
  const cy = h / 2 + view.offsetY;

  let gs = 1;
  if (up < 12) gs = 2;
  if (up < 6) gs = 5;
  if (up < 3) gs = 10;
  if (up < 1.5) gs = 20;
  if (up > 80) gs = 0.5;
  if (up > 160) gs = 0.25;

  ctx.strokeStyle = '#f0f0f0';
  ctx.lineWidth = 1;
  ctx.beginPath();
  const sgx = Math.floor((-cx) / (up * gs)) * gs;
  const egx = Math.ceil((w - cx) / (up * gs)) * gs;
  for (let g = sgx; g <= egx; g += gs) {
    const px = cx + g * up;
    if (Math.abs(g) > 0.0001) { ctx.moveTo(px, 0); ctx.lineTo(px, h); }
  }
  const sgy = Math.floor((cy - h) / (up * gs)) * gs;
  const egy = Math.ceil(cy / (up * gs)) * gs;
  for (let g = sgy; g <= egy; g += gs) {
    const py = cy - g * up;
    if (Math.abs(g) > 0.0001) { ctx.moveTo(0, py); ctx.lineTo(w, py); }
  }
  ctx.stroke();

  ctx.strokeStyle = '#000000';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(0, cy); ctx.lineTo(w, cy);
  ctx.moveTo(cx, 0); ctx.lineTo(cx, h);
  ctx.stroke();

  ctx.fillStyle = '#000000';
  ctx.beginPath();
  ctx.moveTo(w - 8, cy - 4); ctx.lineTo(w, cy); ctx.lineTo(w - 8, cy + 4);
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(cx - 4, 8); ctx.lineTo(cx, 0); ctx.lineTo(cx + 4, 8);
  ctx.fill();

  ctx.fillStyle = '#6c6c6c';
  ctx.font = '11px ui-monospace, "Cascadia Code", "Source Code Pro", monospace';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  for (let g = sgx; g <= egx; g += gs) {
    if (Math.abs(g) < 0.0001) continue;
    const px = cx + g * up;
    if (px < 10 || px > w - 10) continue;
    ctx.fillText(Math.abs(g) >= 1 ? String(g) : g.toString(), px, Math.min(cy + 6, h - 16));
  }
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  for (let g = sgy; g <= egy; g += gs) {
    if (Math.abs(g) < 0.0001) continue;
    const py = cy - g * up;
    if (py < 10 || py > h - 10) continue;
    ctx.fillText(Math.abs(g) >= 1 ? String(g) : g.toString(), Math.min(cx + 6, w - 30), py);
  }
  if (cx > 5 && cx < w - 5 && cy > 5 && cy < h - 5) ctx.fillText('0', cx + 4, cy + 8);
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
    //    Distinguish: a^(...) has '^(' vs x^2 has '^' followed by a number
    const hasExpAsymptote = exprLower.match(/\^\s*\(/) || exprLower.match(/\d+\^/);

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
  const rx = (w - cx0) / up, lx = (-cx0) / up;
  const off = li * 24;
  for (const f of [0.85, 0.7, 0.5, 0.3, 0.15]) {
    const tx = lx + (rx - lx) * f;
    let yv: number | null;
    if (entry.mode === 'polar') {
      const r = evaluatePolar(compiled, tx, entry.params);
      if (r === null) continue;
      yv = r * Math.sin(tx);
    } else {
      yv = evaluateCartesian(compiled, tx, entry.params);
    }
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

function drawFuncLabel(ctx: CanvasRenderingContext2D, entry: FunctionEntry, w: number, h: number, view: ViewState, li: number) {
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

  // Superscripts
  const SUP: Record<string, string> = { '0': '\u2070', '1': '\u00B9', '2': '\u00B2', '3': '\u00B3', '4': '\u2074', '5': '\u2075', '6': '\u2076', '7': '\u2077', '8': '\u2078', '9': '\u2079', '-': '\u207B' };
  display = display.replace(/\^([0-9-]+)/g, (_, num) => num.split('').map((ch: string) => SUP[ch] ?? ch).join(''));
  display = display.replace(/theta/g, '\u03B8').replace(/sqrt/g, '\u221A');
  const label = prefix + display;

  ctx.font = '12px ui-monospace, "SF Mono", "Menlo", monospace';
  const tm = ctx.measureText(label);
  const pw = 6;
  const lw = tm.width + pw * 2;
  const lh = 22;
  const rx = Math.min(pos.cx, w - lw - 10);

  ctx.fillStyle = 'rgba(255,255,255,0.95)';
  ctx.beginPath();
  (ctx as any).roundRect(rx, pos.cy - lh / 2, lw, lh, 3);
  ctx.fill();

  ctx.fillStyle = '#000';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillText(label, rx + 6, pos.cy);
}

export function drawFunctionLabels(ctx: CanvasRenderingContext2D, functions: FunctionEntry[], w: number, h: number, view: ViewState) {
  let idx = 0;
  for (const e of functions) {
    if (!e.visible || !e.expression.trim()) continue;
    drawFuncLabel(ctx, e, w, h, view, idx);
    idx++;
  }
}

// ==== HOVER ====
export function findNearestPoint(mx: number, my: number, entries: FunctionEntry[], w: number, h: number, view: ViewState): TooltipData | null {
  const [mathX] = canvasToMath(mx, my, w, h, view);
  let bestY: number | null = null;
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

    let yVal: number | null;
    if (entry.mode === 'polar') {
      const r = evaluatePolar(compiled, mathX, entry.params);
      if (r === null) continue;
      yVal = r * Math.sin(mathX);
    } else {
      yVal = evaluateCartesian(compiled, mathX, entry.params);
    }
    if (yVal === null) continue;
    const [, canvasY] = mathToCanvas(mathX, yVal, w, h, view);
    const dist = Math.abs(canvasY - my);
    if (dist < minDist && dist < 50) { minDist = dist; bestY = yVal; }
  }
  if (bestY === null) return null;
  const [canvasX, canvasY] = mathToCanvas(mathX, bestY, w, h, view);
  return { x: mathX, y: bestY, canvasX, canvasY };
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
