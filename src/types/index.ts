export type FunctionMode = 'cartesian' | 'polar';

export interface ParamRange {
  min: number;
  max: number;
  step: number;
}

export interface FunctionEntry {
  id: string;
  expression: string;
  visible: boolean;
  color: string;
  params: Record<string, number>;
  mode: FunctionMode;
  domainMin: string;
  domainMax: string;
  paramRanges: Record<string, ParamRange>;
  showAsymptotes: boolean;
}

export interface ViewState {
  scale: number;
  offsetX: number;
  offsetY: number;
  piMode?: boolean;
}

export interface Point {
  x: number;
  y: number;
}

export interface TooltipData {
  x: number;
  y: number;
  canvasX: number;
  canvasY: number;
}

export interface PresetFunction {
  name: string;
  expression: string;
  params: Record<string, number>;
  mode: FunctionMode;
  domainMin: string;
  domainMax: string;
}
