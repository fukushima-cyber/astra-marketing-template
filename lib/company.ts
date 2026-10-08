export const companyMetrics = {
  revenue: {label: '確定売上', unit: '円'},
  payments: {label: '入金', unit: '円'},
  refunds: {label: '返金', unit: '円'},
  cost: {label: '広告費', unit: '円'},
  sales: {label: '成約', unit: '件'},
  registrations: {label: '登録数', unit: '件'},
} as const;
export type CompanyMetric = keyof typeof companyMetrics;
export type CompanyMetrics = Record<CompanyMetric, number | null> &
  Record<`${CompanyMetric}Count`, number> & {
    records: number; days: number; definitions: number; latest: string | null;
  };
export type CompanyDay = CompanyMetrics & {date: string};
export type CompanyBusiness = {
  id: string; name: string; kind: import('./business').BusinessKind; metrics: CompanyMetrics | null;
  daily: CompanyDay[] | null; restrictedProjects: boolean; objective: string | null;
  goals: {id: string; title: string; target: number; deadline: string}[];
  pendingImprovements: number | null;
};
export type CompanySummary = {
  company: {name: string}; businesses: CompanyBusiness[];
  scope: string; start: string; end: string;
};
export const partialMetric = (metrics: CompanyMetrics, metric: CompanyMetric) =>
  metrics[metric] !== null && metrics[`${metric}Count`] < metrics.records;

// Keep missing days as gaps, without allocating every day in a long date range.
export function dailySegments(days: CompanyDay[], metric: CompanyMetric) {
  const segments: {date: string; value: number; partial: boolean}[][] = [];
  let previous = '';
  for (const day of days) {
    const value = day[metric];
    if (value === null) { previous = ''; continue; }
    if (!previous || Date.parse(day.date) - Date.parse(previous) !== 86400000) segments.push([]);
    segments[segments.length - 1].push({date: day.date, value, partial: partialMetric(day, metric)});
    previous = day.date;
  }
  return segments;
}
