import { useState, useRef, useEffect, useCallback } from 'react';

interface EditableExpressionProps {
  expression: string;
  params: Record<string, number>;
  mode: 'cartesian' | 'polar';
  onParamChange: (name: string, value: number) => void;
}

// ==== Unicode formatting ====
const SUB_DIGIT: Record<string, string> = {
  '0': '\u2080', '1': '\u2081', '2': '\u2082', '3': '\u2083', '4': '\u2084',
  '5': '\u2085', '6': '\u2086', '7': '\u2087', '8': '\u2088', '9': '\u2089',
  '.': '\u002E', '-': '\u208B',
};

function toSubscript(str: string): string {
  return str.split('').map(ch => SUB_DIGIT[ch] ?? ch).join('');
}

function formatValue(v: number): string {
  if (Number.isInteger(v)) return String(v);
  return v.toFixed(2).replace(/\.?0+$/, '');
}

/**
 * Global formatting on the full expression (after param substitution).
 * Uses ^marker and √marker for later HTML rendering.
 */
function formatGlobal(expr: string): string {
  let s = expr;

  // abs → ||
  while (s.includes('abs(')) {
    s = s.replace(/abs\(([^()]+)\)/g, '|$1|');
    s = s.replace(/abs\(([^()]*\([^()]*\)[^()]*)\)/g, '|$1|');
  }

  // Log base subscript: log(x)/log(10) → log₁₀(x)
  s = s.replace(/log\(([^)]+)\)\s*\/\s*log\(([^)]+)\)/g, (_, inner, base) => {
    return `log${toSubscript(base)}(${inner})`;
  });

  // 1* and -1* removal (Safari-compatible)
  s = s.replace(/(^|[^0-9.])1\*(?=[a-zA-Z(])/g, '$1');
  s = s.replace(/(^|[^0-9.])-1\*(?=[a-zA-Z(])/g, '$1-');

  // Reciprocal trig: N/sin → Ncosec, N/cos → Nsec, N/tan → Ncot
  // Handles any coefficient: 1/sin, 2.5/sin, a/sin, etc.
  // MUST happen BEFORE * removal and fraction line replacement!
  s = s.replace(/([a-zA-Z]|\d+\.?\d*)\/sin\(/g, '$1cosec(');
  s = s.replace(/([a-zA-Z]|\d+\.?\d*)\/cos\(/g, '$1sec(');
  s = s.replace(/([a-zA-Z]|\d+\.?\d*)\/tan\(/g, '$1cot(');

  // Remove remaining *
  s = s.replace(/\*/g, '');

  // Omit standalone coefficient 1: 1sin → sin, 1abs → abs, 1|x| → |x|, etc.
  s = s.replace(/(^|[^a-zA-Z0-9.])1(?=[a-zA-Z(])/g, '$1');

  // Omit coefficient 1 for reciprocal trig: 1cosec → cosec, 1sec → sec, 1cot → cot
  s = s.replace(/(^|[^a-zA-Z0-9.])1cosec\(/g, '$1cosec(');
  s = s.replace(/(^|[^a-zA-Z0-9.])1sec\(/g, '$1sec(');
  s = s.replace(/(^|[^a-zA-Z0-9.])1cot\(/g, '$1cot(');

  // Fraction line for a/x patterns (skip already-converted cosec/sec/cot)
  s = s.replace(/(\w)\/([a-zA-Z])/g, '$1\u2044$2');

  // Superscripts: use ^ as marker for HTML <sup> rendering
  s = s.replace(/\^\(([^)]+)\)/g, '^$1');
  // Keep ^ prefix as marker — will be rendered as <sup> in React

  // Math symbols
  s = s.replace(/theta/g, '\u03B8');
  s = s.replace(/sqrt/g, '\u221A');  // sqrt(x) → √(x), keep parens
  s = s.replace(/\bpi\b/g, '\u03C0');

  // ==== Comprehensive zero-coefficient cleanup (repeat until stable) ====
  let prev: string;
  do {
    prev = s;
    // Remove +0 inside parens: (x+0) → (x), (0+x) → (x)
    s = s.replace(/\(x\+0\)/g, '(x)');
    s = s.replace(/\(0\+x\)/g, '(x)');
    // Remove redundant single-variable parens: (x) → x
    s = s.replace(/\(x\)/g, 'x');
    // Remove +0x, -0x, +0, -0 at term boundaries
    s = s.replace(/\+0x(?=[+-]|\)|$)/g, '');
    s = s.replace(/-0x(?=[+-]|\)|$)/g, '');
    s = s.replace(/\+0(?=[+-]|\)|$)/g, '');
    s = s.replace(/-0(?=[+-]|\)|$)/g, '');
    // Fix double signs produced by removals
    s = s.replace(/\+\+/g, '+');
    s = s.replace(/\+-/g, '-');
    s = s.replace(/--/g, '+');
    s = s.replace(/-\+/g, '-');
    // Fix leading signs
    s = s.replace(/^\+/g, '');
  } while (s !== prev);

  return s;
}

/**
 * Build segments: substitute param values, format globally, then scan
 * for param values to create clickable segments.
 */
function buildSegments(
  expr: string,
  params: Record<string, number>
): { text: string; isParam: boolean; paramName?: string; paramValue?: number }[] {
  if (!expr) return [];

  // Step 1: Substitute param values (longest name first)
  let substituted = expr;
  const sortedParams = Object.entries(params).sort((a, b) => b[0].length - a[0].length);
  for (const [name, value] of sortedParams) {
    const valStr = formatValue(value);
    substituted = substituted.replace(new RegExp(`\\b${name}\\b`, 'g'), valStr);
  }

  // Step 2: Apply global formatting
  const formatted = formatGlobal(substituted);

  // Step 3: Build search list of all param values
  const searchValues: { valStr: string; name: string; value: number }[] = [];
  for (const [name, value] of sortedParams) {
    searchValues.push({ valStr: formatValue(value), name, value });
  }
  // Sort by length descending to match longest first
  const sortedByLength = [...searchValues].sort((a, b) => b.valStr.length - a.valStr.length);

  // Step 4: Scan formatted string left-to-right
  const segments: { text: string; isParam: boolean; paramName?: string; paramValue?: number }[] = [];
  let pos = 0;

  while (pos < formatted.length) {
    let matched = false;

    for (const { valStr, name, value } of sortedByLength) {
      if (formatted.substring(pos, pos + valStr.length) === valStr) {
        const before = pos > 0 ? formatted[pos - 1] : '';
        const after = pos + valStr.length < formatted.length ? formatted[pos + valStr.length] : '';
        if (!/[a-zA-Z0-9.]/.test(before) && !/[a-zA-Z0-9.]/.test(after)) {
          // text = param name (shown in edit mode), paramValue for display in normal mode
          segments.push({ text: name, isParam: true, paramName: name, paramValue: value });
          pos += valStr.length;
          matched = true;
          break;
        }
      }
    }

    if (!matched) {
      let text = '';
      while (pos < formatted.length) {
        let isParamStart = false;
        for (const { valStr } of sortedByLength) {
          if (formatted.substring(pos, pos + valStr.length) === valStr) {
            const before = pos > 0 ? formatted[pos - 1] : '';
            const after = pos + valStr.length < formatted.length ? formatted[pos + valStr.length] : '';
            if (!/[a-zA-Z0-9.]/.test(before) && !/[a-zA-Z0-9.]/.test(after)) {
              isParamStart = true;
              break;
            }
          }
        }
        if (isParamStart) break;
        text += formatted[pos];
        pos++;
      }
      if (text) segments.push({ text, isParam: false });
    }
  }

  return segments;
}

/**
 * Render a text segment with special formatting:
 * - num⁄denom → fraction (numerator / overline / denominator)
 * - √content → square root with overline
 * - ^x → <sup>x</sup>
 * - logₙ → log with subscript n
 * - θ, π, etc.
 */
function renderTextSegment(text: string): React.ReactNode[] {
  const parts: React.ReactNode[] = [];
  let remaining = text;
  let keyIdx = 0;

  while (remaining.length > 0) {
    // Fraction: num⁄denom (U+2044 fraction slash)
    const fracMatch = remaining.match(/^([^\u2044]*)\u2044([^\u2044]*)/);
    if (fracMatch) {
      const [, numer, denom] = fracMatch;
      parts.push(
        <span key={keyIdx++} className="inline-flex flex-col items-center mx-0.5" style={{ verticalAlign: 'middle' }}>
          <span className="text-xs pb-0.5">{numer || ' '}</span>
          <span className="w-full border-t border-black" style={{ minWidth: '12px' }} />
          <span className="text-xs pt-0.5">{denom || ' '}</span>
        </span>
      );
      remaining = remaining.slice(fracMatch[0].length);
      continue;
    }

    // Superscript: ^x
    const supMatch = remaining.match(/^\^([a-zA-Z0-9\u03B8\u03C0\u221A]+)/);
    if (supMatch) {
      parts.push(
        <sup key={keyIdx++} className="text-[0.75em] align-super leading-none">
          {supMatch[1]}
        </sup>
      );
      remaining = remaining.slice(supMatch[0].length);
      continue;
    }

    // Log with subscript base
    const subMatch = remaining.match(/^log([\u2080-\u2089\u208B.]+)/);
    if (subMatch) {
      parts.push(
        <span key={keyIdx++}>
          log<sub className="text-[0.75em] align-sub">{subMatch[1]}</sub>
        </span>
      );
      remaining = remaining.slice(subMatch[0].length);
      continue;
    }

    // Take one character
    parts.push(<span key={keyIdx++}>{remaining[0]}</span>);
    remaining = remaining.slice(1);
  }

  return parts;
}

export default function EditableExpression({ expression, params, mode, onParamChange }: EditableExpressionProps) {
  const [editingParam, setEditingParam] = useState<string | null>(null);
  const [editValue, setEditValue] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  const prefix = mode === 'polar' ? 'r = ' : 'y = ';
  const segments = buildSegments(expression, params);

  useEffect(() => {
    if (editingParam && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [editingParam]);

  const handleEditSubmit = useCallback(
    (name: string) => {
      const v = parseFloat(editValue);
      if (!isNaN(v)) onParamChange(name, v);
      setEditingParam(null);
    },
    [editValue, onParamChange]
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent, name: string) => {
      if (e.key === 'Enter') handleEditSubmit(name);
      if (e.key === 'Escape') setEditingParam(null);
    },
    [handleEditSubmit]
  );

  return (
    <span className="text-base text-black font-medium mono-num leading-relaxed">
      <span className="text-[#6c6c6c] font-normal">{prefix}</span>
      {segments.map((seg, i) => {
        if (!seg.isParam || !seg.paramName) {
          return <span key={i}>{renderTextSegment(seg.text)}</span>;
        }

        if (editingParam === seg.paramName) {
          return (
            <input
              key={i}
              ref={inputRef}
              type="text"
              value={editValue}
              onChange={(e) => setEditValue(e.target.value)}
              onBlur={() => handleEditSubmit(seg.paramName!)}
              onKeyDown={(e) => handleKeyDown(e, seg.paramName!)}
              className="inline-block w-14 text-base font-medium mono-num border-b-2 border-[#4f46e5] bg-[#f0f0ff] px-0.5 py-0 focus:outline-none text-black"
            />
          );
        }

        // Always show param VALUE (numeric), never param name
        const displayText = formatValue(seg.paramValue ?? 0);
        return (
          <button
            key={i}
            onClick={() => {
              setEditingParam(seg.paramName!);
              const v = seg.paramValue ?? 0;
              setEditValue(formatValue(v));
            }}
            className="inline-block mono-num font-semibold text-black px-0.5 rounded-sm transition-colors cursor-pointer hover:bg-[#eef0ff]"
            style={{
              borderBottom: '2px solid #4f46e5',
              paddingBottom: '1px',
            }}
            title={`点击修改 ${seg.paramName} = ${seg.paramValue}`}
          >
            {displayText}
          </button>
        );
      })}
    </span>
  );
}
