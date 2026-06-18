import { useState, useCallback, useRef, useEffect } from 'react';
import { Play, Pause, Settings2 } from 'lucide-react';

interface ParamSliderProps {
  name: string;
  value: number;
  onChange: (name: string, value: number) => void;
  onRangeChange?: (name: string, min: number, max: number, step: number) => void;
  min?: number;
  max?: number;
  step?: number;
}

export default function ParamSlider({
  name,
  value,
  onChange,
  onRangeChange,
  min = -10,
  max = 10,
  step = 0.1,
}: ParamSliderProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [editValue, setEditValue] = useState(value.toFixed(2));
  const [isPlaying, setIsPlaying] = useState(false);
  const [showRange, setShowRange] = useState(false);
  const [rangeMin, setRangeMin] = useState(String(min));
  const [rangeMax, setRangeMax] = useState(String(max));
  const [rangeStep, setRangeStep] = useState(String(step));
  const animRef = useRef<number>(0);
  const directionRef = useRef(1);

  const triggerChange = useCallback(
    (v: number) => {
      const clamped = Math.max(min, Math.min(max, v));
      const rounded = Math.round(clamped / step) * step;
      onChange(name, rounded);
    },
    [name, onChange, min, max, step]
  );

  const handleSliderChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      triggerChange(parseFloat(e.target.value));
    },
    [triggerChange]
  );

  const handleEditSubmit = useCallback(() => {
    const v = parseFloat(editValue);
    if (!isNaN(v)) triggerChange(v);
    setIsEditing(false);
  }, [editValue, triggerChange]);

  const handleEditKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter') handleEditSubmit();
      if (e.key === 'Escape') { setEditValue(value.toFixed(2)); setIsEditing(false); }
    },
    [handleEditSubmit, value]
  );

  const handleNudge = useCallback(
    (delta: number) => triggerChange(value + delta),
    [value, triggerChange]
  );

  const togglePlay = useCallback(() => {
    if (isPlaying) {
      setIsPlaying(false);
      cancelAnimationFrame(animRef.current);
    } else {
      setIsPlaying(true);
      const speed = (max - min) * 0.005;
      const animate = () => {
        setIsPlaying((playing) => {
          if (!playing) return false;
          const newVal = value + speed * directionRef.current;
          if (newVal >= max) { directionRef.current = -1; triggerChange(max); }
          else if (newVal <= min) { directionRef.current = 1; triggerChange(min); }
          else triggerChange(newVal);
          animRef.current = requestAnimationFrame(animate);
          return true;
        });
      };
      animRef.current = requestAnimationFrame(animate);
    }
  }, [isPlaying, value, min, max, triggerChange]);

  useEffect(() => () => cancelAnimationFrame(animRef.current), []);

  const handleContainerKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') { e.preventDefault(); handleNudge(-step); }
      if (e.key === 'ArrowRight' || e.key === 'ArrowUp') { e.preventDefault(); handleNudge(step); }
    },
    [handleNudge, step]
  );

  const displayVal = Math.abs(value) < 0.001 && value !== 0 ? value.toExponential(1) : value.toFixed(2);
  const isAtDefault = Math.abs(value - (name === 'd' ? 0 : 1)) < 0.001;

  return (
    <div className="py-1" tabIndex={0} onKeyDown={handleContainerKeyDown}>
      {/* Main slider row */}
      <div className="flex items-center gap-2">
        <span className="text-xs font-semibold text-black w-4 flex-shrink-0">{name}</span>
        <div className="flex-1 min-w-0">
          <input type="range" min={min} max={max} step={step} value={value} onChange={handleSliderChange} className="brutalist-slider" />
        </div>
        {isEditing ? (
          <input type="text" value={editValue} onChange={(e) => setEditValue(e.target.value)} onBlur={handleEditSubmit} onKeyDown={handleEditKeyDown} autoFocus
            className="mono-num w-[52px] text-right text-xs border border-black px-1 py-0.5 outline-none bg-white flex-shrink-0" />
        ) : (
          <button onClick={() => { setEditValue(value.toFixed(2)); setIsEditing(true); }}
            className={`mono-num w-[52px] text-right text-xs text-black hover:bg-[#f0f0f0] px-1 py-0.5 transition-opacity flex-shrink-0 ${isAtDefault ? 'text-[#999]' : 'text-black font-medium'}`}>
            {displayVal}
          </button>
        )}
        <button onClick={togglePlay} className={`p-1 flex-shrink-0 transition-colors ${isPlaying ? 'bg-black text-white' : 'hover:bg-[#f0f0f0] text-[#6c6c6c]'}`} title={isPlaying ? '暂停' : '播放'}>
          {isPlaying ? <Pause className="w-3 h-3" /> : <Play className="w-3 h-3" />}
        </button>
        <button onClick={() => setShowRange(!showRange)} className="p-1 flex-shrink-0 hover:bg-[#f0f0f0] text-[#6c6c6c] transition-colors" title="调整范围">
          <Settings2 className="w-3 h-3" />
        </button>
      </div>

      {/* Range settings panel */}
      {showRange && (
        <div className="flex items-center gap-2 mt-1 pl-5 pr-1">
          <span className="text-[10px] text-[#999]">范围</span>
          <input type="text" value={rangeMin} onChange={(e) => { setRangeMin(e.target.value); const v = parseFloat(e.target.value); if (!isNaN(v)) onRangeChange?.(name, v, max, step); }}
            className="w-10 text-[10px] text-center mono-num border-b border-[#ddd] focus:border-black focus:outline-none text-[#6c6c6c] py-0.5" />
          <span className="text-[10px] text-[#999]">~</span>
          <input type="text" value={rangeMax} onChange={(e) => { setRangeMax(e.target.value); const v = parseFloat(e.target.value); if (!isNaN(v)) onRangeChange?.(name, min, v, step); }}
            className="w-10 text-[10px] text-center mono-num border-b border-[#ddd] focus:border-black focus:outline-none text-[#6c6c6c] py-0.5" />
          <span className="text-[10px] text-[#999]">步长</span>
          <input type="text" value={rangeStep} onChange={(e) => { setRangeStep(e.target.value); const v = parseFloat(e.target.value); if (!isNaN(v) && v > 0) onRangeChange?.(name, min, max, v); }}
            className="w-10 text-[10px] text-center mono-num border-b border-[#ddd] focus:border-black focus:outline-none text-[#6c6c6c] py-0.5" />
        </div>
      )}
    </div>
  );
}
