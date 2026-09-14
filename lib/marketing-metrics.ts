export type Goal = {
  id: string;
  title: string;
  unit: string;
  baseline: number;
  current: number | null;
  target: number;
  direction: "increase" | "decrease";
  weight: number;
  baselinePeriod: string;
  currentPeriod: string;
  observationDays: number;
  comparable: boolean;
  updatedAt: string;
};

export type Progress = {
  value: number | null;
  bar: number | null;
  reason: string | null;
};

const invalid = (reason: string): Progress => ({
  value: null,
  bar: null,
  reason,
});

const isFiniteNumber = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value);

/** 目標の実測値を、基準から目標までの改善率（百分率）に変換する。 */
export function progress(goal: Goal): Progress {
  if (!goal.comparable) {
    return invalid("基準値と現在値を比較できません");
  }
  if (!isFiniteNumber(goal.baseline) || !isFiniteNumber(goal.target)) {
    return invalid("基準値または目標値が未取得です");
  }
  if (goal.current === null || !isFiniteNumber(goal.current)) {
    return invalid("現在値が未取得です");
  }
  if (goal.baseline === goal.target) {
    return invalid("基準値と目標値が同じため算出できません");
  }
  if (
    (goal.direction === "increase" && goal.target <= goal.baseline) ||
    (goal.direction === "decrease" && goal.target >= goal.baseline)
  ) {
    return invalid("増減方向と目標値が一致していません");
  }

  const value =
    goal.direction === "increase"
      ? ((goal.current - goal.baseline) / (goal.target - goal.baseline)) * 100
      : ((goal.baseline - goal.current) / (goal.baseline - goal.target)) * 100;

  if (!Number.isFinite(value)) {
    return invalid("進捗を算出できません");
  }
  return {
    value,
    bar: Math.min(100, Math.max(0, value)),
    reason: null,
  };
}

/** 測定不能な目標を隠さず、重み付きの未丸め進捗を返す。 */
export function overallProgress(goals: Goal[]): Progress {
  if (goals.length === 0) {
    return invalid("目標が未設定です");
  }

  let weightedTotal = 0;
  let totalWeight = 0;
  for (const goal of goals) {
    const result = progress(goal);
    if (result.value === null) {
      return invalid(`総合進捗を算出できません：${result.reason ?? "測定不能な目標があります"}`);
    }
    if (!isFiniteNumber(goal.weight) || goal.weight < 0) {
      return invalid("重みは0以上の有限値で指定してください");
    }
    weightedTotal += result.value * goal.weight;
    totalWeight += goal.weight;
    if (!Number.isFinite(weightedTotal) || !Number.isFinite(totalWeight)) {
      return invalid("重み付き進捗が有限値を超えたため算出できません");
    }
  }
  if (!Number.isFinite(totalWeight) || totalWeight <= 0) {
    return invalid("重みの合計が0のため総合進捗を算出できません");
  }

  const value = weightedTotal / totalWeight;
  if (!Number.isFinite(value)) {
    return invalid("総合進捗が有限値を超えたため算出できません");
  }
  return {
    value,
    bar: Math.min(100, Math.max(0, value)),
    reason: null,
  };
}
