/**
 * 节假日数据模块：中国法定节假日信息的获取、缓存与工作日计算。
 *
 * 数据源：https://v1.apizero.cn/api/holiday（?year=YYYY 指定年份），返回
 * { code, msg, data: { year, list: [{ name, holiday: ['YYYY-MM-DD'...], workday: [...], days }] } }，
 * 其中 holiday 为放假日期、workday 为调休上班日（如周六补班）。
 *
 * 缓存策略（key：cycleTracker:holiday:v1，localStorage）：
 * - 按「响应体 data.year」归档：接口某天突然从 2026 年信息变为 2027 年信息时，
 *   同样按新年份自动缓存，对应年份在节假日日历中立即按工作日口径生效；
 * - 每年成功获取一次即长期缓存；失败（年份暂不支持/断网等）记录尝试时间，
 *   24 小时内不重试，避免反复请求；年份公布后自动补全；
 * - 缓存不可用（如隐私模式）时仍可正常使用「仅跳过周末」的降级规则。
 *
 * 内存态 liveCache 与 localStorage 同步，工作日引擎（buildWorkdayEngine）
 * 的方法在调用时读取 liveCache，因此数据更新后无需重建引擎即可生效。
 */
import { addDaysKey, diffDays, keyToDate, todayKey } from './cycleAlgo';

const API_BASE = 'https://v1.apizero.cn/api/holiday';
const CACHE_KEY = 'cycleTracker:holiday:v1';

/** 失败后的重试间隔：24 小时 */
const RETRY_INTERVAL_MS = 24 * 60 * 60 * 1000;

/** 预测推算的时间跨度（天），与 cycleAlgo.genPredictions 默认值保持一致 */
const HORIZON_DAYS = 730;

/**
 * 缓存结构：
 * {
 *   version: 1,
 *   years: { '2026': { year, fetchedAt, source, days: { 'YYYY-MM-DD': { t: 'h'|'w', n: '节日名' } } } },
 *   attempts: { '2027': 'ISO 时间（最近一次失败尝试，用于限制重试频率）' },
 * }
 */
let liveCache = loadCache();

/** 读取 localStorage 缓存；损坏或不可用时返回空缓存 */
function loadCache() {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return { version: 1, years: {}, attempts: {} };
    const parsed = JSON.parse(raw);
    return {
      version: 1,
      years: parsed?.years && typeof parsed.years === 'object' ? parsed.years : {},
      attempts: parsed?.attempts && typeof parsed.attempts === 'object' ? parsed.attempts : {},
    };
  } catch {
    return { version: 1, years: {}, attempts: {} };
  }
}

/** 写回 localStorage（失败仅告警，内存态继续可用） */
function persist() {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(liveCache));
  } catch (err) {
    console.warn('节假日缓存保存失败', err);
  }
}

/** 查询某日期的节假日信息：{ t: 'h'（放假）| 'w'（调休上班）, n: 节日名 }；无数据返回 null */
export function getHolidayDay(key) {
  const yearData = liveCache.years[key.slice(0, 4)];
  return yearData?.days?.[key] ?? null;
}

/**
 * 汇总某日历需要节假日数据的年份：
 * 起始 = 最早记录年份；结束 = max(最后记录, 今天) + 推算跨度所在年份；
 * 另并入额外年份（如当前浏览年份、今年）。
 * @returns {number[]} 升序年份数组
 */
export function collectNeededYears({ records = [], extraYears = [], horizonDays = HORIZON_DAYS } = {}) {
  const years = new Set(extraYears.filter(Number.isInteger));
  const dates = records.map((r) => r.date).sort();
  if (dates.length > 0) {
    const startYear = Number(dates[0].slice(0, 4));
    const lastKey = dates[dates.length - 1];
    const tKey = todayKey();
    const refKey = diffDays(lastKey, tKey) > 0 ? tKey : lastKey; // 取较晚者
    const endYear = Number(addDaysKey(refKey, horizonDays).slice(0, 4));
    for (let y = startYear; y <= endYear; y += 1) years.add(y);
  }
  return [...years].sort((a, b) => a - b);
}

/** 请求 JSON；HTTP 非 2xx、网络异常或响应无法解析时返回 null */
async function requestJson(url) {
  try {
    const res = await fetch(url, { cache: 'no-store' });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

/**
 * 校验并归一化接口响应 → { year, fetchedAt, source, days }；无效返回 null。
 * days 为逐日索引：'YYYY-MM-DD' → { t: 'h'（放假）| 'w'（调休上班）, n: 节日名 }
 */
function normalizePayload(json, source) {
  const data = json?.data;
  if (
    json?.code !== 0 ||
    !data ||
    !Number.isInteger(data.year) ||
    !Array.isArray(data.list) ||
    data.list.length === 0
  ) {
    return null;
  }
  const days = {};
  const dateRe = /^\d{4}-\d{2}-\d{2}$/;
  data.list.forEach((festival) => {
    const name = typeof festival?.name === 'string' && festival.name ? festival.name : '法定节假日';
    (Array.isArray(festival.holiday) ? festival.holiday : []).forEach((d) => {
      if (dateRe.test(d)) days[d] = { t: 'h', n: name };
    });
    (Array.isArray(festival.workday) ? festival.workday : []).forEach((d) => {
      if (dateRe.test(d)) days[d] = { t: 'w', n: name };
    });
  });
  if (Object.keys(days).length === 0) return null;
  return { year: data.year, fetchedAt: new Date().toISOString(), source, days };
}

/**
 * 拉取并缓存某年份数据。
 * 优先按年份查询；接口暂不支持该年份（如 400「year 仅支持…」）时，
 * 对「今年及以后」兜底请求默认接口，并按响应体 data.year 归档，
 * 使接口数据年更替时对应年份自动纳入节假日口径。
 */
async function fetchAndCacheYear(year) {
  const key = String(year);
  let normalized = normalizePayload(await requestJson(`${API_BASE}?year=${year}`), `${API_BASE}?year=${year}`);
  if (!normalized && year >= new Date().getFullYear()) {
    normalized = normalizePayload(await requestJson(API_BASE), API_BASE);
  }
  if (!normalized) {
    liveCache.attempts[key] = new Date().toISOString();
    persist();
    return;
  }
  liveCache.years[String(normalized.year)] = normalized;
  if (normalized.year === year) {
    delete liveCache.attempts[key];
  } else {
    // 兜底响应的是其他年份：归档该年份，但仍标记入参年份暂不可用
    liveCache.attempts[key] = new Date().toISOString();
  }
  persist();
}

/** 同一年份的并发请求去重（StrictMode 双调用、多个日历同时打开时共用一次请求） */
const inFlight = new Map();

/**
 * 确保指定年份的节假日数据可用（已缓存跳过；失败 24 小时内不重试）。
 * @returns {Promise<{ fetched: number[], missing: number[] }>}
 *   fetched：本次新成功缓存的年份；missing：请求后仍不可用的年份
 */
export async function ensureHolidayYears(years) {
  const unique = [...new Set(years)].filter(Number.isInteger).sort((a, b) => a - b);
  const fetched = [];
  const missing = [];
  await Promise.all(
    unique.map(async (year) => {
      const key = String(year);
      if (liveCache.years[key]) return;
      const attemptAt = liveCache.attempts[key] ? Date.parse(liveCache.attempts[key]) : 0;
      if (Number.isFinite(attemptAt) && Date.now() - attemptAt < RETRY_INTERVAL_MS) {
        missing.push(year);
        return;
      }
      if (!inFlight.has(key)) {
        inFlight.set(
          key,
          fetchAndCacheYear(year).finally(() => inFlight.delete(key))
        );
      }
      await inFlight.get(key);
      if (liveCache.years[key]) fetched.push(year);
      else missing.push(year);
    })
  );
  return { fetched: fetched.sort((a, b) => a - b), missing: missing.sort((a, b) => a - b) };
}

/**
 * 某日期是否为工作日：调休上班 → true；法定放假 → false；
 * 无数据的年份退化为「仅跳过周末」规则。
 */
export function isWorkday(key) {
  const info = getHolidayDay(key);
  if (info?.t === 'w') return true;
  if (info?.t === 'h') return false;
  const week = keyToDate(key).getDay();
  return week !== 0 && week !== 6;
}

/** 统计 (aKey, bKey] 区间内的工作日天数（不含 aKey、含 bKey） */
export function workdayDiff(aKey, bKey) {
  const total = diffDays(aKey, bKey);
  if (total <= 0) return 0;
  let count = 0;
  let key = aKey;
  for (let i = 1; i <= total; i += 1) {
    key = addDaysKey(key, 1);
    if (isWorkday(key)) count += 1;
  }
  return count;
}

/** 从 key 起前进 n 个工作日后的日期（n <= 0 时返回原日期；落地日必为工作日） */
export function addWorkdays(key, n) {
  if (!Number.isFinite(n) || n <= 0) return key;
  let remain = n;
  let cur = key;
  while (remain > 0) {
    cur = addDaysKey(cur, 1);
    if (isWorkday(cur)) remain -= 1;
  }
  return cur;
}

/**
 * 工作日引擎：节假日日历的间隔统计与预测推算统一通过引擎执行；
 * 引擎方法在调用时读取内存态缓存，因此 ensureHolidayYears 之后自动生效。
 */
export function buildWorkdayEngine() {
  return {
    isWorkday,
    workdayDiff,
    addWorkdays,
  };
}
