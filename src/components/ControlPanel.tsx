import { useState } from 'react';
import { Plus, Download, Share2 } from 'lucide-react';
import type { FunctionEntry, PresetFunction } from '@/types';
import FunctionInput from './FunctionInput';

interface ControlPanelProps {
  functions: FunctionEntry[];
  onUpdate: (id: string, updates: Partial<FunctionEntry>) => void;
  onRemove: (id: string) => void;
  onAdd: () => void;
  onApplyPreset: (preset: PresetFunction) => void;
  onExport: () => void;
  onShare: () => void;
}

// ===== Trigonometric presets: a=amplitude, b=frequency, c=horizontal shift, d=vertical shift =====
// All presets use domain -10 ~ 10, all have a,b,c,d four sliders
// Expression form: a*sin(b*x+c)+d — NOT b*(x+c), to avoid double parens when c=0 or b=1
// Trig presets grouped by row for display
const TRIG_ROWS: PresetFunction[][] = [
  // Row 1: basic trig
  [
    { name: 'sin', expression: 'a*sin(b*x+c)+d', params: { a: 1, b: 1, c: 0, d: 0 }, mode: 'cartesian', domainMin: '-10', domainMax: '10' },
    { name: 'cos', expression: 'a*cos(b*x+c)+d', params: { a: 1, b: 1, c: 0, d: 0 }, mode: 'cartesian', domainMin: '-10', domainMax: '10' },
    { name: 'tan', expression: 'a*tan(b*x+c)+d', params: { a: 1, b: 1, c: 0, d: 0 }, mode: 'cartesian', domainMin: '-10', domainMax: '10' },
  ],
  // Row 2: reciprocal trig
  [
    { name: 'sec',  expression: 'a*sec(b*x+c)+d',  params: { a: 1, b: 1, c: 0, d: 0 }, mode: 'cartesian', domainMin: '-10', domainMax: '10' },
    { name: 'csc',  expression: 'a/sin(b*x+c)+d',  params: { a: 1, b: 1, c: 0, d: 0 }, mode: 'cartesian', domainMin: '-10', domainMax: '10' },
    { name: 'cot',  expression: 'a*cot(b*x+c)+d',  params: { a: 1, b: 1, c: 0, d: 0 }, mode: 'cartesian', domainMin: '-10', domainMax: '10' },
  ],
  // Row 3: inverse trig
  [
    { name: 'arcsin', expression: 'a*asin(b*x+c)+d', params: { a: 1, b: 1, c: 0, d: 0 }, mode: 'cartesian', domainMin: '-1', domainMax: '1' },
    { name: 'arccos', expression: 'a*acos(b*x+c)+d', params: { a: 1, b: 1, c: 0, d: 0 }, mode: 'cartesian', domainMin: '-1', domainMax: '1' },
    { name: 'arctan', expression: 'a*atan(b*x+c)+d', params: { a: 1, b: 1, c: 0, d: 0 }, mode: 'cartesian', domainMin: '-10', domainMax: '10' },
  ],
  // Row 4: hyperbolic trig
  [
    { name: 'sinh', expression: 'a*sinh(b*x+c)+d', params: { a: 1, b: 1, c: 0, d: 0 }, mode: 'cartesian', domainMin: '-10', domainMax: '10' },
    { name: 'cosh', expression: 'a*cosh(b*x+c)+d', params: { a: 1, b: 1, c: 0, d: 0 }, mode: 'cartesian', domainMin: '-10', domainMax: '10' },
    { name: 'tanh', expression: 'a*tanh(b*x+c)+d', params: { a: 1, b: 1, c: 0, d: 0 }, mode: 'cartesian', domainMin: '-10', domainMax: '10' },
  ],
];

// ===== Algebraic / other presets: d=vertical offset =====
// All presets use domain -10 ~ 10, except log uses 0 ~ 10
const ALGEBRA_PRESETS: PresetFunction[] = [
  { name: '一次函数 linear',      expression: 'a*x+b', params: { a: 1, b: 0 }, mode: 'cartesian', domainMin: '-10', domainMax: '10' },
  { name: '二次抛物线 parabola',  expression: 'a*x^2+b*x+c', params: { a: 1, b: 0, c: 0 }, mode: 'cartesian', domainMin: '-10', domainMax: '10' },
  { name: '指数增长 exponential', expression: 'a^(b*x+c)+d', params: { a: 2, b: 1, c: 0, d: 0 }, mode: 'cartesian', domainMin: '-10', domainMax: '10' },
  { name: '对数 log',              expression: 'log(b*x+c)/log(a)+d', params: { a: 10, b: 1, c: 0, d: 0 }, mode: 'cartesian', domainMin: '0', domainMax: '10' },
  { name: '双曲线 hyperbola',      expression: 'a/(b*x+c)+d', params: { a: 1, b: 1, c: 0, d: 0 }, mode: 'cartesian', domainMin: '-10', domainMax: '10' },
  { name: '绝对值 absolute',       expression: 'a*abs(b*x+c)+d', params: { a: 1, b: 1, c: 0, d: 0 }, mode: 'cartesian', domainMin: '-10', domainMax: '10' },
  { name: '根号 sqrt',             expression: 'a*sqrt(b*x+c)+d', params: { a: 1, b: 1, c: 0, d: 0 }, mode: 'cartesian', domainMin: '0', domainMax: '10' },
];

const POLAR_PRESETS: PresetFunction[] = [
  { name: '玫瑰线 rose',           expression: 'a*sin(b*theta)', params: { a: 1, b: 4 }, mode: 'polar', domainMin: '0', domainMax: '4pi' },
  { name: '心形线 cardioid',       expression: 'a*(1+cos(theta))', params: { a: 1 }, mode: 'polar', domainMin: '0', domainMax: '4pi' },
  { name: '阿基米德 spiral',       expression: 'a*theta', params: { a: 0.5 }, mode: 'polar', domainMin: '0', domainMax: '4pi' },
  { name: '对数螺旋 log spiral',   expression: 'a*(1.1^theta)', params: { a: 0.5 }, mode: 'polar', domainMin: '0', domainMax: '4pi' },
  { name: '双纽线 lemniscate',     expression: 'a*sqrt(cos(2*theta))', params: { a: 1 }, mode: 'polar', domainMin: '0', domainMax: '4pi' },
  { name: '圆 circle',             expression: 'a', params: { a: 2 }, mode: 'polar', domainMin: '0', domainMax: '4pi' },
];

/** Display with θ instead of theta */
function fmt(name: string): string {
  return name.replace(/theta/g, '\u03B8');
}

type CartesianTab = 'trig' | 'algebra';

export default function ControlPanel({
  functions, onUpdate, onRemove, onAdd, onApplyPreset, onExport, onShare,
}: ControlPanelProps) {
  const [cartTab, setCartTab] = useState<CartesianTab>('trig');

  return (
    <div className="w-[360px] flex-shrink-0 flex flex-col h-full bg-[#f9f9f9] border-l border-[#e5e5e5]">
      {/* Header */}
      <div className="px-5 py-4 border-b border-[#e5e5e5]">
        <h1 className="text-xl font-bold text-black tracking-tight">函数绘图大师</h1>
        <p className="text-xs text-[#6c6c6c] mt-1 leading-relaxed">
          输入函数式，拖动滑块观察图像变化。支持定义域限制。
        </p>
      </div>

      <div className="flex-1 overflow-y-auto custom-scroll px-4 py-4 space-y-3">
        {/* Functions list */}
        <div className="space-y-3">
          {functions.map((entry, idx) => (
            <FunctionInput key={entry.id} entry={entry} index={idx} onUpdate={onUpdate} onRemove={onRemove} />
          ))}
        </div>

        {functions.length < 6 && (
          <button onClick={onAdd} className="w-full flex items-center justify-center gap-2 py-2.5 border border-dashed border-[#c0c0c0] text-[#6c6c6c] hover:border-black hover:text-black transition-colors text-sm">
            <Plus className="w-4 h-4" />
            添加函数
          </button>
        )}

        {/* ===== Cartesian presets with tabs ===== */}
        <div className="pt-4 border-t border-[#e5e5e5]">
          <h3 className="text-xs font-medium text-[#6c6c6c] uppercase tracking-wider mb-2">直角坐标预设</h3>
          {/* Tab buttons */}
          <div className="flex gap-0 mb-3">
            <button
              onClick={() => setCartTab('trig')}
              className={`flex-1 py-1.5 text-xs font-medium border transition-colors ${
                cartTab === 'trig'
                  ? 'bg-black text-white border-black'
                  : 'bg-white text-[#6c6c6c] border-[#e5e5e5] hover:border-black'
              }`}
            >
              三角函数
            </button>
            <button
              onClick={() => setCartTab('algebra')}
              className={`flex-1 py-1.5 text-xs font-medium border border-l-0 transition-colors ${
                cartTab === 'algebra'
                  ? 'bg-black text-white border-black'
                  : 'bg-white text-[#6c6c6c] border-[#e5e5e5] hover:border-black'
              }`}
            >
              代数函数
            </button>
          </div>
          {/* Tab content */}
          {cartTab === 'trig' && (
            <div className="space-y-2">
              {TRIG_ROWS.map((row, ri) => (
                <div key={ri} className="grid grid-cols-3 gap-2">
                  {row.map((p) => (
                    <button key={p.name} onClick={() => onApplyPreset(p)} className="pill-btn justify-center">{fmt(p.name)}</button>
                  ))}
                </div>
              ))}
            </div>
          )}
          {cartTab === 'algebra' && (
            <div className="grid grid-cols-2 gap-2">
              {ALGEBRA_PRESETS.map((p) => (
                <button key={p.name} onClick={() => onApplyPreset(p)} className="pill-btn justify-center">{fmt(p.name)}</button>
              ))}
            </div>
          )}
        </div>

        {/* ===== Polar presets ===== */}
        <div className="pt-4 border-t border-[#e5e5e5]">
          <h3 className="text-xs font-medium text-[#6c6c6c] uppercase tracking-wider mb-3">极坐标预设</h3>
          <div className="grid grid-cols-3 gap-2">
            {POLAR_PRESETS.map((p) => (
              <button key={p.name} onClick={() => onApplyPreset(p)} className="pill-btn justify-center">{fmt(p.name)}</button>
            ))}
          </div>
        </div>

        {/* Tips */}
        <div className="pt-4 border-t border-[#e5e5e5]">
          <h3 className="text-xs font-medium text-[#6c6c6c] uppercase tracking-wider mb-2">使用提示</h3>
          <ul className="text-xs text-[#6c6c6c] space-y-1 leading-relaxed">
            <li>所有预设均带 a/b 可调参数滑块</li>
            <li>支持定义域限制: 输入范围如 0 ~ 10</li>
            <li>键盘: +/- 缩放, 0 重置, 拖拽平移</li>
          </ul>
        </div>
      </div>

      <div className="px-4 py-3 border-t border-[#e5e5e5] flex gap-2">
        <button onClick={onExport} className="flex-1 flex items-center justify-center gap-1.5 py-2 text-sm border border-black bg-white text-black hover:bg-black hover:text-white transition-colors">
          <Download className="w-3.5 h-3.5" />
          导出 PNG
        </button>
        <button onClick={onShare} className="flex-1 flex items-center justify-center gap-1.5 py-2 text-sm border border-black bg-white text-black hover:bg-black hover:text-white transition-colors">
          <Share2 className="w-3.5 h-3.5" />
          分享链接
        </button>
      </div>
    </div>
  );
}
