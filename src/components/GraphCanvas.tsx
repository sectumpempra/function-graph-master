import { useRef, useEffect, useCallback, useState } from 'react';
import { ZoomIn, ZoomOut, Maximize } from 'lucide-react';
import type { FunctionEntry, ViewState, TooltipData } from '@/types';
import {
  drawGrid,
  drawFunction,
  drawFunctionLabels,
  findNearestPoint,
  drawHoverIndicator,
  canvasToMath,
} from '@/lib/graphRenderer';

interface GraphCanvasProps {
  functions: FunctionEntry[];
}

export default function GraphCanvas({ functions }: GraphCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<ViewState>({ scale: 1, offsetX: 0, offsetY: 0, piMode: false });
  const sizeRef = useRef({ width: 0, height: 0 });
  const dprRef = useRef(1);
  const [tooltip, setTooltip] = useState<TooltipData | null>(null);
  const [tooltipPos, setTooltipPos] = useState({ left: 0, top: 0 });
  const [piMode, setPiMode] = useState(false);
  const isDragging = useRef(false);
  const lastMouse = useRef({ x: 0, y: 0 });
  const needsRenderRef = useRef(true);
  const zoom = useCallback((factor: number) => {
    const { width, height } = sizeRef.current;
    const view = viewRef.current;
    const centerX = width / 2;
    const centerY = height / 2;
    const [beforeX, beforeY] = canvasToMath(centerX, centerY, width, height, view);
    view.scale = Math.max(0.02, Math.min(100, view.scale * factor));
    const [afterX, afterY] = canvasToMath(centerX, centerY, width, height, view);
    view.offsetX += (afterX - beforeX) * 40 * view.scale;
    view.offsetY -= (afterY - beforeY) * 40 * view.scale;
    needsRenderRef.current = true;
  }, []);

  const resetView = useCallback(() => {
    viewRef.current = { scale: 1, offsetX: 0, offsetY: 0, piMode: viewRef.current.piMode };
    needsRenderRef.current = true;
  }, []);

  const togglePiMode = useCallback(() => {
    setPiMode((prev) => {
      const next = !prev;
      viewRef.current.piMode = next;
      needsRenderRef.current = true;
      return next;
    });
  }, []);

  const render = useCallback(() => {
    needsRenderRef.current = false;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const { width, height } = sizeRef.current;
    if (width === 0 || height === 0) return;

    const view = viewRef.current;
    drawGrid(ctx, width, height, view);

    for (const entry of functions) {
      drawFunction(ctx, entry, width, height, view);
    }

    drawFunctionLabels(ctx, functions, width, height, view);

    if (tooltip) {
      drawHoverIndicator(ctx, tooltip, width, height, view);
    }
  }, [functions, tooltip]);

  // Render loop: only request next frame when rendering is actually needed
  useEffect(() => {
    let animId: number | null = null;
    const loop = () => {
      animId = null;
      if (needsRenderRef.current) render();
    };

    // Start loop
    animId = requestAnimationFrame(loop);

    // Check periodically if new render is needed (e.g. after mouse events set flag)
    const checkInterval = setInterval(() => {
      if (needsRenderRef.current && animId === null) {
        animId = requestAnimationFrame(loop);
      }
    }, 50);

    return () => {
      clearInterval(checkInterval);
      if (animId !== null) cancelAnimationFrame(animId);
    };
  }, [render]);

  useEffect(() => {
    needsRenderRef.current = true;
  });

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const resize = () => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const dpr = window.devicePixelRatio || 1;
      dprRef.current = dpr;
      const rect = container.getBoundingClientRect();
      const w = Math.round(rect.width);
      const h = Math.round(rect.height);
      sizeRef.current = { width: w, height: h };
      canvas.width = w * dpr;
      canvas.height = h * dpr;
      canvas.style.width = w + 'px';
      canvas.style.height = h + 'px';
      const ctx = canvas.getContext('2d');
      if (ctx) ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      needsRenderRef.current = true;
    };

    resize();
    const ro = new ResizeObserver(() => resize());
    ro.observe(container);
    return () => ro.disconnect();
  }, []);

  // Keyboard shortcuts for zoom (laptops without scroll wheel)
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      // Only handle if canvas area is focused or no input is focused
      const target = e.target as HTMLElement;
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') return;

      if (e.key === '+' || e.key === '=') {
        e.preventDefault();
        zoom(1.25);
      } else if (e.key === '-' || e.key === '_') {
        e.preventDefault();
        zoom(0.8);
      } else if (e.key === '0') {
        e.preventDefault();
        resetView();
      }
    };

    container.addEventListener('keydown', handleKeyDown);
    container.tabIndex = 0;
    return () => container.removeEventListener('keydown', handleKeyDown);
  }, [zoom, resetView]);

  const handleMouseMove = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const rect = canvas.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      const { width, height } = sizeRef.current;

      if (isDragging.current) {
        const dx = x - lastMouse.current.x;
        const dy = y - lastMouse.current.y;
        viewRef.current.offsetX += dx;
        viewRef.current.offsetY += dy;
        lastMouse.current = { x, y };
        needsRenderRef.current = true;
        return;
      }

      const found = findNearestPoint(x, y, functions, width, height, viewRef.current);
      if (found) {
        setTooltip(found);
        setTooltipPos({
          left: Math.min(found.canvasX + 16, width - 160),
          top: Math.max(found.canvasY - 50, 8),
        });
        needsRenderRef.current = true;
      } else {
        if (tooltip) {
          setTooltip(null);
          needsRenderRef.current = true;
        }
      }
    },
    [functions, tooltip]
  );

  const handleMouseDown = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    isDragging.current = true;
    lastMouse.current = { x: e.clientX - rect.left, y: e.clientY - rect.top };
    canvas.style.cursor = 'grabbing';
  }, []);

  const handleMouseUp = useCallback(() => {
    isDragging.current = false;
    const canvas = canvasRef.current;
    if (canvas) canvas.style.cursor = 'crosshair';
  }, []);

  const handleWheel = useCallback(
    (e: React.WheelEvent<HTMLCanvasElement>) => {
      e.preventDefault();
      const canvas = canvasRef.current;
      if (!canvas) return;
      const rect = canvas.getBoundingClientRect();
      const mouseX = e.clientX - rect.left;
      const mouseY = e.clientY - rect.top;
      const { width, height } = sizeRef.current;
      const view = viewRef.current;
      const [beforeX, beforeY] = canvasToMath(mouseX, mouseY, width, height, view);
      const delta = e.deltaY > 0 ? 0.9 : 1.1;
      view.scale = Math.max(0.02, Math.min(100, view.scale * delta));
      const [afterX, afterY] = canvasToMath(mouseX, mouseY, width, height, view);
      view.offsetX += (afterX - beforeX) * 40 * view.scale;
      view.offsetY -= (afterY - beforeY) * 40 * view.scale;
      needsRenderRef.current = true;
    },
    []
  );

  const handleDoubleClick = useCallback(() => {
    resetView();
  }, [resetView]);

  return (
    <div
      ref={containerRef}
      className="relative w-full h-full overflow-hidden select-none"
      tabIndex={0}
    >
      <canvas
        ref={canvasRef}
        className="absolute inset-0"
        style={{ cursor: 'crosshair' }}
        onMouseMove={handleMouseMove}
        onMouseDown={handleMouseDown}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
        onWheel={handleWheel}
        onDoubleClick={handleDoubleClick}
      />

      {/* Zoom controls */}
      <div className="absolute top-4 left-4 flex flex-col gap-1 bg-white border border-[#e5e5e5] shadow-sm z-20">
        <button onClick={() => zoom(1.25)} className="p-2 hover:bg-[#f5f5f5] transition-colors" title="放大 (+)">
          <ZoomIn className="w-4 h-4 text-[#333]" />
        </button>
        <button onClick={() => zoom(0.8)} className="p-2 hover:bg-[#f5f5f5] transition-colors border-t border-[#e5e5e5]" title="缩小 (-)">
          <ZoomOut className="w-4 h-4 text-[#333]" />
        </button>
        <button onClick={resetView} className="p-2 hover:bg-[#f5f5f5] transition-colors border-t border-[#e5e5e5]" title="重置视图 (0)">
          <Maximize className="w-4 h-4 text-[#333]" />
        </button>
        <button
          onClick={togglePiMode}
          className={`p-2 transition-colors border-t border-[#e5e5e5] text-xs font-bold mono-num ${
            piMode ? 'bg-black text-white' : 'hover:bg-[#f5f5f5] text-[#333]'
          }`}
          title="切换 π 刻度"
        >
          {piMode ? 'π' : 'x'}
        </button>
      </div>

      {/* Keyboard shortcuts hint */}
      <div className="absolute bottom-3 left-4 z-10 pointer-events-none">
        <span className="text-[10px] text-[#bbb] mono-num">
          +/- 缩放 &nbsp;|&nbsp; 0 重置 &nbsp;|&nbsp; 拖拽平移
        </span>
      </div>

      {tooltip && (
        <div
          className="absolute pointer-events-none z-10 px-3 py-2 bg-white border border-black tooltip-fade"
          style={{ left: tooltipPos.left, top: tooltipPos.top }}
        >
          <div className="mono-num text-xs text-black">
            <span className="text-[#6c6c6c]">x:</span>{' '}
            {tooltip.x.toFixed(2)}
          </div>
          <div className="mono-num text-xs text-black mt-0.5">
            <span className="text-[#6c6c6c]">y:</span>{' '}
            {tooltip.y.toFixed(2)}
          </div>
        </div>
      )}
    </div>
  );
}
