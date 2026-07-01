import { useState, useCallback, useRef, useEffect } from 'react';
import type { FunctionEntry, PresetFunction } from '@/types';
import { getFunctionColor, getNextUnusedColor } from '@/lib/graphRenderer';
import GraphCanvas from '@/components/GraphCanvas';
import ControlPanel from '@/components/ControlPanel';
import { Toaster, toast } from 'sonner';

let idCounter = 0;
function generateId(): string {
  idCounter++;
  return 'func_' + idCounter + '_' + Math.random().toString(36).slice(2, 5);
}

function createDefaultFunction(index: number): FunctionEntry {
  return {
    id: generateId(),
    expression: index === 0 ? 'a*sin(b*x+c)+d' : '',
    visible: true,
    color: getFunctionColor(index),
    params: { a: 1, b: 1, c: 0, d: 0 },
    mode: 'cartesian',
    domainMin: '',
    domainMax: '',
    paramRanges: {},
    showAsymptotes: true,
  };
}

function serializeState(functions: FunctionEntry[]): string {
  const data = functions.map((f) => ({
    e: f.expression,
    v: f.visible,
    c: f.color,
    p: f.params,
    m: f.mode,
    d1: f.domainMin,
    d2: f.domainMax,
    r: f.paramRanges,
    sa: f.showAsymptotes,
  }));
  return btoa(encodeURIComponent(JSON.stringify(data)));
}

function deserializeState(hash: string): FunctionEntry[] | null {
  try {
    const decoded = decodeURIComponent(atob(hash));
    const data = JSON.parse(decoded);
    if (!Array.isArray(data)) return null;
    return data.map((item: any, index: number) => ({
      id: generateId(),
      expression: item.e || '',
      visible: item.v !== false,
      color: item.c || getFunctionColor(index),
      params: item.p || {},
      mode: item.m || 'cartesian',
      domainMin: item.d1 || '',
      domainMax: item.d2 || '',
      paramRanges: item.r || {},
      showAsymptotes: item.sa !== false,
    }));
  } catch {
    return null;
  }
}

export default function App() {
  const canvasContainerRef = useRef<HTMLDivElement>(null);

  const [functions, setFunctions] = useState<FunctionEntry[]>(() => {
    if (window.location.hash.length > 1) {
      const restored = deserializeState(window.location.hash.slice(1));
      if (restored && restored.length > 0) return restored;
    }
    return [createDefaultFunction(0)];
  });

  const handleUpdate = useCallback((id: string, updates: Partial<FunctionEntry>) => {
    setFunctions((prev) => prev.map((f) => (f.id === id ? { ...f, ...updates } : f)));
  }, []);

  const handleRemove = useCallback((id: string) => {
    setFunctions((prev) => prev.filter((f) => f.id !== id));
  }, []);

  const handleAdd = useCallback(() => {
    setFunctions((prev) => {
      if (prev.length >= 6) return prev;
      const newIndex = prev.length;
      return [
        ...prev,
        {
          id: generateId(),
          expression: '',
          visible: true,
          color: getFunctionColor(newIndex),
          params: {},
          mode: 'cartesian',
          domainMin: '',
          domainMax: '',
          paramRanges: {},
          showAsymptotes: true,
        },
      ];
    });
  }, []);

  const handleApplyPreset = useCallback((preset: PresetFunction) => {
    setFunctions((prev) => {
      if (prev.length >= 6) {
        toast.error('最多支持 6 个函数');
        return prev;
      }

      const mergedParams: Record<string, number> = {};
      for (const [k, v] of Object.entries(preset.params)) {
        mergedParams[k] = v;
      }

      // Pick the first unused color
      const usedColors = prev.map((f) => f.color);
      const color = getNextUnusedColor(usedColors);

      // Always add as a new function (never overwrite existing)
      return [
        ...prev,
        {
          id: generateId(),
          expression: preset.expression,
          params: mergedParams,
          visible: true,
          color,
          mode: preset.mode,
          domainMin: preset.domainMin,
          domainMax: preset.domainMax,
          paramRanges: {},
          showAsymptotes: true,
        },
      ];
    });
  }, []);

  const handleExport = useCallback(() => {
    const container = canvasContainerRef.current;
    if (!container) return;
    const canvasEl = container.querySelector('canvas');
    if (!canvasEl) return;
    try {
      const link = document.createElement('a');
      link.download = 'function-graph.png';
      link.href = (canvasEl as HTMLCanvasElement).toDataURL('image/png');
      link.click();
      toast.success('图像已导出');
    } catch {
      toast.error('导出失败');
    }
  }, []);

  const handleShare = useCallback(() => {
    const hash = serializeState(functions);
    const url = window.location.origin + window.location.pathname + '#' + hash;
    // Check URL length — most browsers limit to ~8000 chars, but 2000 is a safe threshold
    if (url.length > 2000) {
      toast.error('链接过长，请改用导出 PNG 分享');
      return;
    }
    navigator.clipboard.writeText(url).then(() => toast.success('链接已复制')).catch(() => toast.error('复制失败'));
  }, [functions]);

  useEffect(() => {
    const timer = setTimeout(() => {
      try { window.history.replaceState(null, '', '#' + serializeState(functions)); }
      catch { /* URL too long */ }
    }, 800);
    return () => clearTimeout(timer);
  }, [functions]);

  return (
    <div className="h-screen w-screen flex overflow-hidden bg-white">
      <div ref={canvasContainerRef} className="flex-1 h-full">
        <GraphCanvas functions={functions} />
      </div>
      <ControlPanel
        functions={functions}
        onUpdate={handleUpdate}
        onRemove={handleRemove}
        onAdd={handleAdd}
        onApplyPreset={handleApplyPreset}
        onExport={handleExport}
        onShare={handleShare}
      />
      <Toaster
        position="bottom-left"
        toastOptions={{ style: { background: '#000', color: '#fff', border: 'none', borderRadius: '0', fontSize: '13px' } }}
      />
    </div>
  );
}
