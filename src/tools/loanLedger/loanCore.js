/**
 * 借贷账簿 - 核心纯逻辑：id 生成、数据修复、金额换算、结清/逾期计算与列表排序。
 *
 * 数据结构（内存、localStorage 缓存与 Gitee 存档同构）：
 * {
 *   version: 1,
 *   items: [
 *     {
 *       id,                             // 事项唯一 uid（自动生成）
 *       lender,                         // 出借人
 *       borrower,                       // 借款人
 *       amount,                         // 借款总金额（元，两位小数）
 *       loanDate: 'YYYY-MM-DD',         // 出借日期（缺失/非法时自动回退为登记日期）
 *       paymentMethod: string,          // 支付方式（可选填；空串表示未填写）
 *       dueDate: 'YYYY-MM-DD' | null,   // 还款日期（可空）
 *       createdAt, updatedAt,           // ISO 时间
 *       repayments: [                   // 还款记录（可分多次；paymentMethod 为还款支付方式，可选填、空串表示未填写）
 *         { id, date: 'YYYY-MM-DD', amount, paymentMethod, createdAt },
 *       ],
 *     },
 *   ],
 * }
 *
 * 金额一律以「元」为存储单位（两位小数），计算时统一换算为「分」比较，
 * 避免浮点误差：累计已还（分）≥ 总金额（分）即判定「已结清」；
 * 单笔还款金额不能超过当前剩余未还金额（由表单校验与修复逻辑共同约束）。
 */

/** 日期 key 格式：YYYY-MM-DD（本地日期字符串，规避 UTC/时区偏移） */
const DATE_KEY_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** 生成唯一 id（优先使用 crypto.randomUUID） */
export function genId() {
  if (globalThis.crypto?.randomUUID) return crypto.randomUUID();
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/** 生成空账簿数据 */
export function makeEmptyData() {
  return { version: 1, items: [] };
}

/** 今天的本地日期 key（YYYY-MM-DD） */
export function todayKey(now = new Date()) {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/** 是否合法的 YYYY-MM-DD 日期 key（含真实日期校验，如 2026-02-30 不合法） */
export function isValidDateKey(value) {
  const m = DATE_KEY_RE.exec(String(value ?? ''));
  if (!m) return false;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  const dt = new Date(Date.UTC(y, mo - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === mo - 1 && dt.getUTCDate() === d;
}

/** 时间字段是否为合法 ISO 字符串 */
export function isValidIso(value) {
  return typeof value === 'string' && !Number.isNaN(Date.parse(value));
}

/** 日期 key → UTC 毫秒（仅用于两个 key 间求天数差） */
function keyToUtc(key) {
  const [y, m, d] = String(key).split('-').map(Number);
  return Date.UTC(y, m - 1, d);
}

/**
 * 两个日期 key 间相差的天数（to - from）；任一 key 非法时返回 0。
 * 基于 UTC 计算，规避本地时区导致的半日偏差。
 */
export function daysBetween(fromKey, toKey) {
  if (!isValidDateKey(fromKey) || !isValidDateKey(toKey)) return 0;
  return Math.round((keyToUtc(toKey) - keyToUtc(fromKey)) / 86400e3);
}

/** 金额（元）→ 分（四舍五入取整；非法值按 0 处理） */
export function toCents(value) {
  const n = Number(value);
  return Number.isFinite(n) ? Math.round(n * 100) : 0;
}

/** 金额规范化为两位小数的「元」 */
export function round2(value) {
  return Math.round(Number(value) * 100) / 100;
}

/** 金额（元）格式化：两位小数 + 千分位（不含货币符号） */
export function fmtMoney(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return '0.00';
  return n.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/** ISO 时间 → 本地时间文本（如 2026-09-11 21:30:00） */
export function fmtDateTime(iso) {
  if (!isValidIso(iso)) return '—';
  try {
    return new Date(iso).toLocaleString('zh-CN', { hour12: false });
  } catch {
    return iso;
  }
}

/** 事项展示名：出借人 → 借款人（空值兜底「未填写」） */
export function itemLabel(item) {
  return `${item?.lender || '未填写'} → ${item?.borrower || '未填写'}`;
}

/** 还款记录按时间升序：先按还款日期，同日期按记录创建时间，最后按 id 保证稳定 */
function compareRepaymentsAsc(a, b) {
  if (a.date !== b.date) return a.date < b.date ? -1 : 1;
  const ta = Date.parse(a.createdAt) || 0;
  const tb = Date.parse(b.createdAt) || 0;
  if (ta !== tb) return ta - tb;
  return String(a.id).localeCompare(String(b.id));
}

/** 累计已还金额（分） */
export function itemRepaidCents(item) {
  let sum = 0;
  for (const r of item?.repayments ?? []) sum += toCents(r.amount);
  return sum;
}

/**
 * 排除指定还款记录后，该事项还能记录的还款金额上限（分）。
 * - 新增还款：不传 excludeRepaymentId，上限即当前剩余未还金额；
 * - 编辑还款：传入被编辑记录的 id，上限 = 剩余未还 + 该笔原金额（修改后累计仍不能超总额）。
 */
export function maxRepaymentCents(item, excludeRepaymentId) {
  let others = 0;
  for (const r of item?.repayments ?? []) {
    if (r.id !== excludeRepaymentId) others += toCents(r.amount);
  }
  return Math.max(0, toCents(item?.amount) - others);
}

/** 计算结清日期：按还款日期升序累计，首次达到总金额的那笔还款的日期（未结清返回 null） */
function computeSettleDate(item, amountCents) {
  const sorted = [...(item?.repayments ?? [])].sort(compareRepaymentsAsc);
  let acc = 0;
  for (const r of sorted) {
    acc += toCents(r.amount);
    if (acc >= amountCents) return r.date;
  }
  return null;
}

/**
 * 事项统计（列表与详情共用的派生数据源）：
 * - settled：累计已还 ≥ 总金额即已结清；
 * - settleDate：结清那天（最后一笔达到总额的还款日期）；
 * - overdueDays：未结清且已过还款日期时的已逾期天数（否则 0）；
 * - dueInDays：未结清且未逾期时距还款日期的剩余天数（0 = 今天到期；无还款日期为 null）；
 * - settleOverdueDays：已结清且有还款日期时，结清日期相对还款日期的天数差
 *   （正 = 逾期 N 天结清，0 = 当天结清，负 = 提前 N 天结清；未结清或无还款日期为 null）。
 */
export function itemStats(item, today = todayKey()) {
  const amountCents = toCents(item?.amount);
  const repaidCents = itemRepaidCents(item);
  const remainingCents = Math.max(0, amountCents - repaidCents);
  const settled = repaidCents >= amountCents;
  const settleDate = settled ? computeSettleDate(item, amountCents) : null;
  const dueDate = item?.dueDate ?? null;

  let overdueDays = 0;
  let dueInDays = null;
  if (!settled && dueDate) {
    const diff = daysBetween(today, dueDate); // 还款日期 - 今天
    if (diff < 0) overdueDays = -diff;
    else dueInDays = diff;
  }

  const settleOverdueDays =
    settled && dueDate && settleDate ? daysBetween(dueDate, settleDate) : null;

  const percent =
    amountCents <= 0 ? 0 : settled ? 100 : Math.min(100, Math.round((repaidCents / amountCents) * 100));

  return {
    amountCents,
    repaidCents,
    remainingCents,
    settled,
    settleDate,
    overdueDays,
    dueInDays,
    settleOverdueDays,
    percent,
  };
}

/**
 * 状态标签信息（Tag 的 color 与文案）：
 * 已结清 > 已逾期 N 天 > 今天到期 > N 天后到期 > 未结清（无还款日期）。
 */
export function statusTagInfo(stats) {
  if (stats.settled) return { color: 'success', text: '已结清' };
  if (stats.overdueDays > 0) return { color: 'error', text: `已逾期 ${stats.overdueDays} 天` };
  if (stats.dueInDays === 0) return { color: 'warning', text: '今天到期' };
  if (stats.dueInDays !== null) return { color: 'blue', text: `${stats.dueInDays} 天后到期` };
  return { color: 'default', text: '未结清' };
}

/**
 * 还款记录列表（按还款日期升序），每行附带「该笔还款后的剩余金额」：
 * 按时间顺序累计计算，剩余金额不低于 0。
 */
export function repaymentRows(item) {
  const sorted = [...(item?.repayments ?? [])].sort(compareRepaymentsAsc);
  const amountCents = toCents(item?.amount);
  let acc = 0;
  return sorted.map((r) => {
    acc += toCents(r.amount);
    return { ...r, remainingCents: Math.max(0, amountCents - acc) };
  });
}

/**
 * 列表展示排序：未结清在前，已结清在后。
 * - 未结清：有还款日期的按到期先后（越紧急越靠前），无还款日期的排在其后；
 * - 已结清：最近结清的在前；
 * - 同级按创建时间倒序（新记录在前）。
 * 存储与云端存档保持登记顺序（追加），排序仅在展示时计算。
 */
export function sortItemsForDisplay(items, today = todayKey()) {
  const statsMap = new Map(items.map((it) => [it.id, itemStats(it, today)]));
  return [...items].sort((a, b) => {
    const sa = statsMap.get(a.id);
    const sb = statsMap.get(b.id);
    if (sa.settled !== sb.settled) return sa.settled ? 1 : -1;
    if (sa.settled) {
      const da = sa.settleDate ?? '';
      const db = sb.settleDate ?? '';
      if (da !== db) return db.localeCompare(da);
    } else {
      const da = a.dueDate ?? '';
      const db = b.dueDate ?? '';
      if (da !== db) {
        if (!da) return 1;
        if (!db) return -1;
        return da.localeCompare(db);
      }
    }
    return (Date.parse(b.createdAt) || 0) - (Date.parse(a.createdAt) || 0);
  });
}

/** 校验候选还款金额（分）：必须 > 0 且不超过上限（分）；返回错误信息，null 表示合法 */
export function validateRepaymentCents(cents, maxCents) {
  if (!Number.isFinite(cents) || cents <= 0) return '还款金额必须大于 0';
  if (cents > maxCents) {
    return `还款金额不能超过剩余未还金额（¥${fmtMoney(maxCents / 100)}）`;
  }
  return null;
}

/**
 * 修复并规范化一组借贷事项（用于本地读取、云端读取与文件导入）。
 * 容错策略：结构可修则修（补 id、清非法日期、补时间字段、出借日期回退登记日期）；
 * 总金额或还款金额无效、还款日期非法的条目无法参与计算，跳过并控制台告警，避免阻塞使用。
 * @param {Array} rawItems 待修复的事项数组
 * @returns {Array} 规范化后的事项数组
 */
export function repairItems(rawItems) {
  const seen = new Set(); // 事项 id 查重
  const items = [];

  for (const raw of Array.isArray(rawItems) ? rawItems : []) {
    if (!raw || typeof raw !== 'object') continue;
    const amountCents = toCents(raw.amount);
    if (amountCents <= 0) {
      // 总金额缺失或非法的条目无法计算剩余/结清，跳过并告警
      console.warn('借贷账簿存档中存在总金额无效的事项，已跳过', raw.id);
      continue;
    }

    let id = typeof raw.id === 'string' && raw.id ? raw.id : genId();
    while (seen.has(id)) {
      id = genId(); // id 重复（手改存档等）：重新生成，避免编辑/删除误伤
    }
    seen.add(id);

    const nowIso = new Date().toISOString();
    const createdAt = isValidIso(raw.createdAt) ? raw.createdAt : nowIso;
    const updatedAt = isValidIso(raw.updatedAt) ? raw.updatedAt : createdAt;

    const repaySeen = new Set();
    const repayments = [];
    for (const rr of Array.isArray(raw.repayments) ? raw.repayments : []) {
      if (!rr || typeof rr !== 'object') continue;
      const rCents = toCents(rr.amount);
      if (rCents <= 0 || !isValidDateKey(rr.date)) {
        // 金额或日期无效的还款记录无法参与计算，跳过并告警
        console.warn('借贷账簿存档中存在金额或日期无效的还款记录，已跳过', rr.id);
        continue;
      }
      let rId = typeof rr.id === 'string' && rr.id ? rr.id : genId();
      while (repaySeen.has(rId)) {
        rId = genId();
      }
      repaySeen.add(rId);
      repayments.push({
        id: rId,
        date: rr.date,
        amount: rCents / 100,
        paymentMethod: String(rr.paymentMethod ?? '').trim().slice(0, 30),
        createdAt: isValidIso(rr.createdAt) ? rr.createdAt : nowIso,
      });
    }

    items.push({
      id,
      lender: String(raw.lender ?? '').trim().slice(0, 30),
      borrower: String(raw.borrower ?? '').trim().slice(0, 30),
      amount: amountCents / 100,
      loanDate: isValidDateKey(raw.loanDate) ? raw.loanDate : todayKey(new Date(createdAt)),
      paymentMethod: String(raw.paymentMethod ?? '').trim().slice(0, 30),
      dueDate: isValidDateKey(raw.dueDate) ? raw.dueDate : null,
      createdAt,
      updatedAt,
      repayments,
    });
  }

  return items;
}

/**
 * 校验导入的 JSON 文本（导出文件或整库备份）并规范化为事项数组。
 * @returns {Array} 规范化后的事项数组
 * @throws 结构不合法时抛出错误
 */
export function parseImported(text) {
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error('文件不是有效的 JSON');
  }
  if (!parsed || !Array.isArray(parsed.items)) {
    throw new Error('缺少 items 数组，不是借贷账簿的存档文件');
  }
  return repairItems(parsed.items);
}
