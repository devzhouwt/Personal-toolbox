/**
 * 日期工具与周期推算算法（加权滑动平均）。
 *
 * 日期统一使用 'YYYY-MM-DD' 本地日期字符串作为 key，
 * 避免 UTC/本地时区换算带来的偏移误差。
 */

const DAY_MS = 24 * 60 * 60 * 1000;

/** Date 对象（本地时间）→ 'YYYY-MM-DD' */
export function toKey(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/** 'YYYY-MM-DD' → 本地时间 Date（午夜） */
export function keyToDate(key) {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y, m - 1, d);
}

/** key 偏移 n 天，返回新 key（n 可为负） */
export function addDaysKey(key, n) {
  const date = keyToDate(key);
  date.setDate(date.getDate() + n);
  return toKey(date);
}

/** 两个 key 相差的天数（b - a） */
export function diffDays(aKey, bKey) {
  return Math.round((keyToDate(bKey) - keyToDate(aKey)) / DAY_MS);
}

/** 今天对应的 key */
export function todayKey() {
  return toKey(new Date());
}

/** 'YYYY-MM-DD' → 'M月D日' */
export function formatMD(key) {
  const [, m, d] = key.split('-').map(Number);
  return `${m}月${d}日`;
}

/** 'YYYY-MM-DD' → 'YYYY年M月D日' */
export function formatYMD(key) {
  const [y, m, d] = key.split('-').map(Number);
  return `${y}年${m}月${d}日`;
}

/** 'YYYY-MM-DD' → '星期X' */
export function weekLabel(key) {
  const week = ['日', '一', '二', '三', '四', '五', '六'];
  return `星期${week[keyToDate(key).getDay()]}`;
}

/**
 * 收集某事件全部发生日期（按时间升序、去重）。
 * @returns {string[]} 日期 key 数组
 */
export function collectEventDates(records, eventId) {
  const keys = records.filter((r) => r.eventId === eventId).map((r) => r.date);
  return [...new Set(keys)].sort();
}

/**
 * 计算周期长度：加权滑动平均。
 * 以相邻两次发生的间隔为样本，越靠近当前的间隔权重越大（线性递增），
 * 从而让近期节奏变化更快地反映到推算结果中。
 * @param {string[]} dates 升序日期 key，至少 2 个才能形成间隔
 * @returns {{ count: number, cycle: number|null, lastDate: string|null }}
 *          cycle 为加权平均天数（保留 1 位小数），不足 2 条记录时为 null
 */
export function calcCycle(dates) {
  const count = dates.length;
  if (count === 0) return { count, cycle: null, lastDate: null };
  if (count === 1) return { count, cycle: null, lastDate: dates[0] };

  const intervals = [];
  for (let i = 1; i < count; i += 1) {
    intervals.push(diffDays(dates[i - 1], dates[i]));
  }
  // 线性加权：最近一次间隔权重最大
  let weightedSum = 0;
  let weightSum = 0;
  intervals.forEach((interval, idx) => {
    const weight = idx + 1;
    weightedSum += interval * weight;
    weightSum += weight;
  });
  const cycle = Math.round((weightedSum / weightSum) * 10) / 10;
  return { count, cycle, lastDate: dates[count - 1] };
}

/**
 * 由最后一次发生日期与周期推算未来发生日期序列。
 * @param {string} lastDate 最后一次发生的日期 key
 * @param {number} cycle 周期（天）
 * @param {number} horizonDays 推算时间跨度（默认约 2 年）
 * @returns {string[]} 未来日期 key 升序（不含 lastDate）
 */
export function genPredictions(lastDate, cycle, horizonDays = 730) {
  if (!cycle || cycle <= 0) return [];
  const predictions = [];
  // k 从 1 起，round(cycle * k) 避免多次累加导致的取整误差累积
  for (let k = 1; ; k += 1) {
    const offset = Math.round(cycle * k);
    if (offset > horizonDays) break;
    predictions.push(addDaysKey(lastDate, offset));
  }
  return predictions;
}

/**
 * 汇总某日历内全部事件的推算结果与预测日期索引。
 * @param {object[]} events 事件定义数组
 * @param {object[]} records 记录数组
 * @returns {{ analyses: object, predictedByDate: object }}
 *   analyses: eventId → { count, cycle, lastDate, nextDate, overdueDays, predictions }
 *   predictedByDate: 'YYYY-MM-DD' → eventId[]
 */
export function buildAnalyses(events, records) {
  const analyses = {};
  const predictedByDate = {};

  events.forEach((event) => {
    const dates = collectEventDates(records, event.id);
    const { count, cycle, lastDate } = calcCycle(dates);
    const predictions = lastDate && cycle ? genPredictions(lastDate, cycle) : [];
    predictions.forEach((key) => {
      (predictedByDate[key] ||= []).push(event.id);
    });

    analyses[event.id] = {
      event,
      count,
      cycle,
      lastDate,
      nextDate: predictions[0] ?? null,
      predictions,
      overdueDays: null,
    };
  });

  // 逾期检查：最近一次预测日期已过去 3 天以上仍未记录，提示可能漏记
  const tKey = todayKey();
  Object.values(analyses).forEach((a) => {
    if (a.nextDate && diffDays(a.nextDate, tKey) > 3) {
      a.overdueDays = diffDays(a.nextDate, tKey);
    }
  });

  return { analyses, predictedByDate };
}
