import { useState, useCallback, useLayoutEffect } from 'react';
import { Eye, EyeOff, Trash2, Pencil, GitBranch } from 'lucide-react';
import type { FunctionEntry } from '@/types';
import { extractParams, compileExpression, convertNumbersToParams, convertNumbersWithExisting } from '@/lib/graphRenderer';
import { domainVariable } from '@/lib/displayUtils';
import EditableExpression from './EditableExpression';
import ParamSlider from './ParamSlider';

interface FunctionInputProps {
  entry: FunctionEntry;
  index: number;
  onUpdate: (id: string, updates: Partial<FunctionEntry>) => void;
  onRemove: (id: string) => void;
}

/** Auto-convert trailing +number/-number to +d param (d=vertical shift), preserving the original value */
function normalizeTrailingConstant(expr: string): { expr: string; defaultValue?: number } {
  const trailingMatch = expr.match(/(.+)([+-])(\d+\.?\d*)$/);
  if (trailingMatch) {
    const [, prefix, sign, numStr] = trailingMatch;
    if (/[a-zA-Z]/.test(numStr)) return { expr };
    const value = parseFloat(sign + numStr);
    return { expr: prefix + '+d', defaultValue: value };
  }
  return { expr };
}

export default function FunctionInput({ entry, index, onUpdate, onRemove }: FunctionInputProps) {
  const [editingExpr, setEditingExpr] = useState(false);
  const [exprInput, setExprInput] = useState(entry.expression);
  const [error, setError] = useState('');

  // Sync exprInput when entry.expression changes externally (e.g. preset click)
  // useLayoutEffect avoids cascading renders that useEffect would cause
  useLayoutEffect(() => { setExprInput(entry.expression); }, [entry.expression]);

  // Auto-enter edit mode when expression is empty
  useLayoutEffect(() => {
    if (!entry.expression.trim()) {
      setEditingExpr(true);
    }
  }, [entry.expression]);

  const validateAndUpdate = useCallback((newExpr: string) => {
    setExprInput(newExpr);
    if (!newExpr.trim()) { setError(''); onUpdate(entry.id, { expression: newExpr }); return; }

    try {
      let finalExpr = newExpr;
      let trailingDDefault: number | undefined;

      // Check for trailing +number/-number and convert to +d (vertical shift)
      const normalized = normalizeTrailingConstant(newExpr);
      if (normalized.expr !== newExpr) {
        finalExpr = normalized.expr;
        trailingDDefault = normalized.defaultValue;
      }

      const compiled = compileExpression(finalExpr);
      if (!compiled) { setError('表达式语法错误'); onUpdate(entry.id, { expression: newExpr }); return; }

      let finalParams = { ...entry.params };
      // If normalizeTrailingConstant introduced d, use the original numeric value
      if (trailingDDefault !== undefined && !('d' in finalParams)) {
        finalParams = { ...finalParams, d: trailingDDefault };
      }

      const extractedParams = extractParams(finalExpr);

      if (extractedParams.length === 0) {
        // No letter params at all: convert all numbers to params
        const converted = convertNumbersToParams(finalExpr);
        if (converted) {
          finalExpr = converted.expression;
          finalParams = converted.params;
          // Preserve trailing d default if it was set
          if (trailingDDefault !== undefined) {
            finalParams = { ...finalParams, d: trailingDDefault };
          }
        }
      } else {
        // Has some letter params: keep them AND convert remaining numbers
        const mergedParams: Record<string, number> = {};
        for (const p of extractedParams) {
          mergedParams[p] = finalParams[p] ?? entry.params[p] ?? (p === 'd' ? 0 : 1);
        }
        // Also convert standalone numbers to additional params
        const converted = convertNumbersWithExisting(finalExpr, extractedParams);
        if (converted) {
          finalExpr = converted.expression;
          for (const [k, v] of Object.entries(converted.params)) {
            if (!(k in mergedParams)) {
              mergedParams[k] = v;
            }
          }
        }
        finalParams = mergedParams;
      }

      // Validate
      const validateCompiled = compileExpression(finalExpr);
      const testScope: Record<string, number> = {
        x: 1, theta: 1, t: 1, e: Math.E, pi: Math.PI, ...finalParams,
      };
      if (validateCompiled) validateCompiled.evaluate(testScope);

      setError('');
      setEditingExpr(false);
      onUpdate(entry.id, { expression: finalExpr, params: finalParams });
    } catch (err: any) {
      setError(err?.message || '无效的表达式');
      onUpdate(entry.id, { expression: newExpr });
    }
  }, [entry.id, entry.params, onUpdate]);

  const handleParamChange = useCallback((name: string, val: number) => {
    onUpdate(entry.id, { params: { ...entry.params, [name]: val } });
  }, [entry.id, entry.params, onUpdate]);

  const handleParamRangeChange = useCallback((name: string, min: number, max: number, step: number) => {
    onUpdate(entry.id, {
      paramRanges: { ...entry.paramRanges, [name]: { min, max, step } },
    });
  }, [entry.id, entry.paramRanges, onUpdate]);

  // Fixed order: a, b, c, d — always consistent regardless of expression
  const ORDER = ['a', 'b', 'c', 'd'];
  const paramNames = Object.keys(entry.params).sort((a, b) => {
    const idxA = ORDER.indexOf(a);
    const idxB = ORDER.indexOf(b);
    if (idxA === -1 && idxB === -1) return a.localeCompare(b);
    if (idxA === -1) return 1;
    if (idxB === -1) return -1;
    return idxA - idxB;
  });
  const hasParams = paramNames.length > 0;
  const varLabel = domainVariable(entry.mode);

  return (
    <div className="border border-[#e5e5e5] bg-white">
      <div className="flex items-center gap-2 px-3 py-2 border-b border-[#e5e5e5]">
        <label className="relative cursor-pointer flex-shrink-0">
          <div className="w-3 h-3" style={{ backgroundColor: entry.color }} />
          <input
            type="color"
            value={entry.color}
            onChange={(e) => onUpdate(entry.id, { color: e.target.value })}
            className="absolute inset-0 opacity-0 w-full h-full cursor-pointer"
            title="更换颜色"
          />
        </label>
        <span className="text-xs font-medium text-[#6c6c6c]">函数 {index + 1}</span>
        {entry.mode === 'polar' && <span className="text-[9px] font-medium text-white bg-[#4f46e5] px-1.5 py-0.5 uppercase tracking-wider">极坐标</span>}
        <div className="flex-1" />
        {/* Asymptote toggle — tan, cot, sec, csc, rational, exp, log */}
        {(entry.expression.includes('tan(') ||
          entry.expression.includes('cot(') ||
          entry.expression.includes('sec(') ||
          entry.expression.includes('csc(') ||
          entry.expression.includes('/sin(') ||
          entry.expression.includes('/cos(') ||
          entry.expression.includes('/tan(') ||
          entry.expression.includes('/x') ||
          entry.expression.match(/\/\([^)]*x/) ||
          entry.expression.match(/\^\s*\(/) ||
          entry.expression.match(/\d+\^/) ||
          entry.expression.includes('log(')) && (
          <button
            onClick={() => onUpdate(entry.id, { showAsymptotes: !entry.showAsymptotes })}
            className="p-1 hover:bg-[#f0f0f0] transition-colors"
            title={entry.showAsymptotes ? '隐藏渐近线' : '显示渐近线'}
          >
            <GitBranch className={`w-3.5 h-3.5 ${entry.showAsymptotes ? 'text-[#4f46e5]' : 'text-[#c0c0c0]'}`} />
          </button>
        )}
        <button onClick={() => onUpdate(entry.id, { visible: !entry.visible })} className="p-1 hover:bg-[#f0f0f0] transition-colors">{entry.visible ? <Eye className="w-3.5 h-3.5 text-[#6c6c6c]" /> : <EyeOff className="w-3.5 h-3.5 text-[#c0c0c0]" />}</button>
        <button onClick={() => onRemove(entry.id)} className="p-1 hover:bg-[#ffeaea] transition-colors" title="删除函数">
          <Trash2 className="w-3.5 h-3.5 text-[#6c6c6c]" />
        </button>
      </div>

      <div className="px-3 py-3">
        {entry.expression.trim() && !editingExpr ? (
          <div className="flex items-baseline gap-2">
            <EditableExpression expression={entry.expression} params={entry.params} mode={entry.mode} onParamChange={handleParamChange} />
            <button onClick={() => setEditingExpr(true)} className="p-1 hover:bg-[#f0f0f0] transition-colors flex-shrink-0" title="编辑表达式"><Pencil className="w-3 h-3 text-[#bbb]" /></button>
          </div>
        ) : (
          <div className="flex items-baseline gap-1">
            <span className="text-sm text-[#6c6c6c] select-none">{entry.mode === 'polar' ? 'r = ' : 'y = '}</span>
            <input type="text" value={exprInput} onChange={(e) => setExprInput(e.target.value)}
              onBlur={() => { if (exprInput === entry.expression && entry.expression.trim()) setEditingExpr(false); else validateAndUpdate(exprInput); }}
              onKeyDown={(e) => { if (e.key === 'Enter') validateAndUpdate(exprInput); if (e.key === 'Escape') { setExprInput(entry.expression); if (entry.expression.trim()) setEditingExpr(false); setError(''); } }}
              autoFocus className="flex-1 bg-transparent text-sm border-b-2 border-[#4f46e5] focus:outline-none px-1 py-0.5 text-black mono-num"
              placeholder="输入函数式，如 a*sin(x)+c" />
          </div>
        )}

        <div className="flex items-center gap-1.5 mt-2">
          <input type="text" value={entry.domainMin} onChange={(e) => onUpdate(entry.id, { domainMin: e.target.value })} placeholder="-10"
            className="w-10 text-[11px] text-center mono-num border-b border-[#ddd] focus:border-black focus:outline-none text-[#6c6c6c] py-0.5" />
          <span className="text-[11px] text-[#999] select-none">{String.fromCharCode(8804)} {varLabel} {String.fromCharCode(8804)}</span>
          <input type="text" value={entry.domainMax} onChange={(e) => onUpdate(entry.id, { domainMax: e.target.value })} placeholder="10"
            className="w-10 text-[11px] text-center mono-num border-b border-[#ddd] focus:border-black focus:outline-none text-[#6c6c6c] py-0.5" />
          {entry.mode === 'polar' && <span className="text-[10px] text-[#bbb]">默认 0 ~ 4π</span>}
        </div>

        {error && <div className="mt-1.5 text-xs text-red-600">{error}</div>}
      </div>

      {hasParams && (
        <div className="px-3 pb-2 border-t border-[#f0f0f0]">
          {paramNames.map((name) => {
            const range = entry.paramRanges[name] || { min: -10, max: 10, step: 0.1 };
            return (
              <ParamSlider key={name} name={name} value={entry.params[name]} onChange={handleParamChange}
                onRangeChange={handleParamRangeChange} min={range.min} max={range.max} step={range.step} />
            );
          })}
        </div>
      )}
    </div>
  );
}
