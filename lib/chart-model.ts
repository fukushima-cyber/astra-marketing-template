export type ChartPoint = {id: string; label: string; value: number | null; date?: string; partial?: boolean; note?: string};
export type ChartSeries = {id: string; label: string; unit: string; points: ChartPoint[]};
export const finiteValue = (n: unknown): number | null => typeof n === 'number' && Number.isFinite(n) ? n : null;
export function countCategories<T>(rows: T[], key: (row: T) => string, names: Record<string, string> = {}): ChartPoint[] {
  const groups = new Map<string, number>();
  for (const row of rows) { const id = key(row) || '未登録'; groups.set(id, (groups.get(id) ?? 0) + 1); }
  return [...groups].map(([id, value]) => ({id, label: names[id] ?? id, value}));
}
export function chartBounds(points: ChartPoint[]) {
  const values = points.map(p => finiteValue(p.value)).filter((n): n is number => n !== null);
  const min = values.reduce((n, v) => Math.min(n, v), 0);
  const max = values.reduce((n, v) => Math.max(n, v), 0);
  return {min, max: max === min ? min + 1 : max};
}
export function chartSegments(points: ChartPoint[]): ChartPoint[][] {
  const segments: ChartPoint[][] = [];
  let previous: ChartPoint | undefined;
  for (const point of points) {
    if (finiteValue(point.value) === null) { previous = undefined; continue; }
    if (!previous || (point.date && previous.date && Date.parse(point.date) - Date.parse(previous.date) !== 86400000)) segments.push([]);
    segments[segments.length - 1].push(point); previous = point;
  }
  return segments;
}

export const numericValue = (value: unknown): number | null => typeof value === 'string' && value.trim() ? finiteValue(Number(value)) : finiteValue(value);
