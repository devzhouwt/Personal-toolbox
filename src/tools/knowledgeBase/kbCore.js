/**
 * 个人知识库 - 核心纯逻辑：命名规则、数据修复、搜索分词/排序、最近回顾与冷门统计。
 *
 * 库数据结构（内存与 localStorage 缓存同构）：
 * {
 *   version: 1,
 *   defaultCategoryId,   // 兜底分类：卡片未指定分类时归入，始终存在且不可删除
 *   categories: [
 *     { id, name, cards: [知识卡片] },   // 卡片所属分类由所在数组推导，不单独存 category 字段
 *   ],
 * }
 *
 * 知识卡片字段（见 PRD 2.1）：id / title / tags / content / createdAt / updatedAt / lastViewedAt?
 */

const DEFAULT_NAME = '未分类';

/** 卡片标题的兜底展示名（新增/编辑时标题留空，或数据修复时标题为空均使用） */
export const DEFAULT_CARD_TITLE = '未命名知识';

/** 允许出现在分类名 / 标签中的控制字符之外的字符范围校验 */
const INVALID_NAME_RE = /[\\/:*?"<>|\u0000-\u001f\u007f]/g;

/** 关键词切分时视为分隔符的常见标点（避免误匹配），保留字母数字汉字与符号 */
const PUNCT_SEP_RE = /[\p{P}]+/gu;

/** 卡片 ID 正则：card_{yyyyMMdd}_{序号} */
const CARD_ID_RE = /^card_\d{8}_(\d+)$/;

/** 生成唯一 id（优先使用 crypto.randomUUID） */
export function genId() {
  if (globalThis.crypto?.randomUUID) return crypto.randomUUID();
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/** 生成新的空知识库状态（含一个不可删除的默认分类「未分类」） */
export function makeEmptyState() {
  const defaultCategoryId = genId();
  return {
    version: 1,
    defaultCategoryId,
    categories: [{ id: defaultCategoryId, name: DEFAULT_NAME, cards: [] }],
  };
}

/** 默认分类显示名（兜底分类的初始名称） */
export function getDefaultCategoryName() {
  return DEFAULT_NAME;
}

/**
 * 由分类名推导云端文件名：默认分类固定为 default.json，其余为「分类名.json」。
 * @param {string} name
 * @returns {string}
 */
export function getCategoryFileName(name) {
  return (name === DEFAULT_NAME ? 'default' : name) + '.json';
}

/** 去除文本中的控制字符与首尾空白，同时去掉文件名非法字符 */
function cleanText(text) {
  return String(text ?? '')
    .trim()
    .replace(INVALID_NAME_RE, '');
}

/**
 * 规范化分类名：清非法字符后返回；空结果视为非法。
 * @returns {string} 规范名
 */
export function sanitizeCategoryName(input) {
  return cleanText(input).slice(0, 20);
}

/**
 * 校验分类名是否可用（新建/重命名时调用）。
 * @param {string} name 候选名称
 * @param {Array} categories 现有分类（用于查重）
 * @param {string} [selfId] 重命名时的自身 id，允许与自身同名
 * @returns {string|null} 错误信息；null 表示可用
 */
export function validateCategoryName(name, categories, selfId) {
  const trimmed = sanitizeCategoryName(name);
  if (!trimmed) return '分类名称不能为空或仅含特殊字符';
  if (trimmed.length > 20) return '分类名称不能超过 20 个字';
  const dup = categories.find(
    (c) => c.id !== selfId && c.name.toLowerCase() === trimmed.toLowerCase()
  );
  if (dup) return `已存在同名分类「${dup.name}」`;
  return null;
}

/**
 * 规范化标签列表：去空、去除控制字符、忽略大小写去重（保留首个原样）、超长截断。
 * @param {Array} tags 原始标签列表
 * @param {number} [max] 数量上限（默认 20）
 * @returns {string[]}
 */
export function normalizeTags(tags, max = 20) {
  const seen = new Map();
  const out = [];
  for (const raw of Array.isArray(tags) ? tags : []) {
    if (typeof raw !== 'string') continue;
    const t = raw.trim().replace(/[\u0000-\u001f\u007f]/g, '').slice(0, 30);
    if (!t) continue;
    const key = t.toLowerCase();
    if (seen.has(key)) continue; // 同一卡片内标签去重（忽略大小写）
    seen.set(key, true);
    out.push(t);
    if (out.length >= max) break;
  }
  return out;
}

/**
 * 生成知识卡片 id：card_{yyyyMMdd}_{当日全局序号}，序号从现有卡片中推算。
 * @param {Array} allCards 全库已有卡片（用于避免重复）
 * @returns {string}
 */
export function genCardId(allCards) {
  const d = new Date();
  const ymd = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(
    d.getDate()
  ).padStart(2, '0')}`;
  const prefix = `card_${ymd}_`;
  let max = 0;
  for (const c of allCards) {
    const m = CARD_ID_RE.exec(c?.id ?? '');
    if (m) max = Math.max(max, Number(m[1]));
  }
  return `${prefix}${String(max + 1).padStart(3, '0')}`;
}

/** 时间字段是否为合法 ISO 字符串 */
export function isValidIso(value) {
  return typeof value === 'string' && !Number.isNaN(Date.parse(value));
}

/**
 * 知识卡片排序键（用于「最近添加」等）：数值越大越新；无时间视为最旧。
 * 冷门统计的「综合活跃时间」= max(updatedAt, lastViewedAt)，与 PRD 3.5 一致。
 */
function cardActiveTime(card) {
  const updated = isValidIso(card?.updatedAt) ? Date.parse(card.updatedAt) : 0;
  const viewed = isValidIso(card?.lastViewedAt) ? Date.parse(card.lastViewedAt) : 0;
  return Math.max(updated, viewed);
}

/** 存储用排序：按综合活跃时间倒序（PRD 3.5 建议冷门查询性能优化的存储顺序） */
export function sortCardsForStore(cards) {
  return [...cards].sort(
    (a, b) => cardActiveTime(b) - cardActiveTime(a)
  );
}

/**
 * 修复并规范化一份知识库数据（用于本地读取、云端读取、文件导入）。
 * 容错策略：结构可修则修（缺字段补齐、重名分类重编号、重复卡片 id 重新生成），
 * 不会整体拒绝；但缺少 categories 数组视为非法。
 * @param {object} raw 待修复数据
 * @returns {object} 规范化后的知识库状态
 */
export function repairState(raw) {
  if (!raw || !Array.isArray(raw.categories)) {
    throw new Error('数据中缺少 categories 数组，不是知识库数据');
  }
  const nowIso = new Date().toISOString();
  const seenIds = new Set(); // 分类 id / 卡片 id 查重
  const seenNames = new Map(); // 分类名（忽略大小写）→ 出现次数，重名时追加 (2)/(3)…
  const categories = [];

  for (const rawCat of raw.categories) {
    if (!rawCat || typeof rawCat !== 'object') continue;
    let name = sanitizeCategoryName(rawCat.name) || DEFAULT_NAME;
    const base = name;
    let n = 1;
    while (seenNames.has(name.toLowerCase())) {
      n += 1;
      name = `${base}(${n})`;
    }
    seenNames.set(name.toLowerCase(), true);

    let id = typeof rawCat.id === 'string' && rawCat.id ? rawCat.id : genId();
    if (seenIds.has(id)) {
      id = `${id}-${genId()}`; // 分类 id 重复：派生新 id 避免 key 冲突
    }
    seenIds.add(id);

    const cards = [];
    for (const rawCard of Array.isArray(rawCat.cards) ? rawCat.cards : []) {
      if (!rawCard || typeof rawCard !== 'object') continue;
      let cardId =
        typeof rawCard.id === 'string' && rawCard.id ? rawCard.id : genCardId([]);
      while (seenIds.has(cardId)) {
        // 卡片 id 重复（跨分类手改等）：重新生成，避免删除/跳转误伤
        cardId = genCardId(cards);
      }
      seenIds.add(cardId);
      cards.push(normalizeCard(rawCard, cardId, nowIso));
    }

    categories.push({ id, name, cards: sortCardsForStore(cards) });
  }

  // 兜底分类保证：defaultCategoryId 必须指向真实分类，否则取第一个；全空则新建
  let defaultCategoryId =
    typeof raw.defaultCategoryId === 'string' &&
    categories.some((c) => c.id === raw.defaultCategoryId)
      ? raw.defaultCategoryId
      : null;
  if (!defaultCategoryId && categories.length > 0) {
    defaultCategoryId = categories[0].id;
  }
  if (!defaultCategoryId) {
    defaultCategoryId = genId();
    categories.push({ id: defaultCategoryId, name: DEFAULT_NAME, cards: [] });
  }
  return { version: 1, defaultCategoryId, categories };
}

/** 修复单张卡片：字段缺失补齐、类型纠正；category 字段忽略（由所在分类推导） */
function normalizeCard(rawCard, id, nowIso) {
  const title = String(rawCard.title ?? '').trim() || DEFAULT_CARD_TITLE;
  const createdAt = isValidIso(rawCard.createdAt) ? rawCard.createdAt : nowIso;
  const updatedAt = isValidIso(rawCard.updatedAt) ? rawCard.updatedAt : createdAt;
  const card = {
    id,
    title: title.slice(0, 200),
    tags: normalizeTags(rawCard.tags),
    content: String(rawCard.content ?? ''),
    createdAt,
    updatedAt,
  };
  if (isValidIso(rawCard.lastViewedAt)) card.lastViewedAt = rawCard.lastViewedAt;
  return card;
}

/**
 * 搜索关键词分词（PRD 3.2.1）：
 * 按空白切分（多个连续空格视为一个分隔符），先剔除常见标点避免误匹配；
 * 空关键词与去重后的重复关键词不参与搜索。
 * @param {string} input
 * @returns {string[]} 小写化、去重后的关键词列表
 */
export function tokenizeKeyword(input) {
  const spaced = String(input ?? '').trim().replace(PUNCT_SEP_RE, ' ');
  const seen = new Set();
  const tokens = [];
  for (const raw of spaced.split(/\s+/)) {
    const t = raw.trim().toLowerCase();
    if (t && !seen.has(t)) {
      seen.add(t);
      tokens.push(t);
    }
  }
  return tokens;
}

/**
 * 知识卡片搜索：按 PRD 3.2 的四级优先级 + 二级排序返回匹配结果。
 * 展示条件：每个关键词要么被标签（完全相等）命中，要么被内容（包含）命中。
 * @param {Array} entries 全库卡片条目（已附 category/categoryId）
 * @param {string} keyword 原始搜索词
 * @returns {{ matched: Array, tokens: string[] }} matched 项为 { entry, priority, tagHits }
 */
export function searchCards(entries, keyword) {
  const tokens = tokenizeKeyword(keyword);
  if (tokens.length === 0) return { matched: [], tokens };

  const matched = [];
  for (const entry of entries) {
    const tags = new Set(
      (Array.isArray(entry.tags) ? entry.tags : [])
        .map((t) => String(t).trim().toLowerCase())
        .filter(Boolean)
    );
    const content = String(entry.content ?? '').toLowerCase();
    let tagHits = 0;
    let allCovered = true;
    for (const tok of tokens) {
      if (tags.has(tok)) tagHits += 1;
      else if (!content.includes(tok)) {
        allCovered = false;
        break;
      }
    }
    if (!allCovered) continue; // 任一关键词完全未命中：不展示
    if (tagHits === tokens.length) {
      // 标签覆盖全部关键词：标签数与关键词数相同 → 第一优先级；更多 → 第二优先级
      const priority = tags.size === tokens.length ? 1 : 2;
      matched.push({ entry, priority, tagHits });
    } else if (tagHits > 0) {
      matched.push({ entry, priority: 3, tagHits }); // 标签命中部分、内容命中剩余
    } else {
      matched.push({ entry, priority: 4, tagHits }); // 标签零命中、内容命中全部
    }
  }

  // 二级排序：同优先级内标签命中数多者优先，再按更新时间、创建时间倒序，最后 id 稳定排序
  matched.sort((a, b) => {
    if (a.priority !== b.priority) return a.priority - b.priority;
    if (a.tagHits !== b.tagHits) return b.tagHits - a.tagHits;
    const diff = compareTime(b.entry, a.entry, 'updatedAt');
    if (diff) return diff;
    const diffCreated = compareTime(b.entry, a.entry, 'createdAt');
    if (diffCreated) return diffCreated;
    return a.entry.id.localeCompare(b.entry.id);
  });
  return { matched, tokens };
}

/** 比较两条目的同一时间字段：返回正数表示 later 更大（用于倒序） */
function compareTime(later, earlier, field) {
  const l = isValidIso(later[field]) ? Date.parse(later[field]) : 0;
  const e = isValidIso(earlier[field]) ? Date.parse(earlier[field]) : 0;
  return l - e;
}

/** 按指定时间字段倒序取前 limit 条（供「最近添加/修改/查看」区块） */
function latestBy(entries, field, limit) {
  return [...entries]
    .filter((e) => isValidIso(e[field]))
    .sort((a, b) => Date.parse(b[field]) - Date.parse(a[field]))
    .slice(0, limit);
}

/**
 * 默认状态的三个最近区块（PRD 3.4）：最近添加 / 最近修改 / 最近查看。
 * 查看仅指进入详情页（列表展示不更新 lastViewedAt，由入口组件保证）。
 * @returns {{ adds: Array, updates: Array, views: Array }}
 */
export function recentSections(entries, limit = 10) {
  return {
    adds: latestBy(entries, 'createdAt', limit),
    updates: latestBy(entries, 'updatedAt', limit),
    views: latestBy(entries, 'lastViewedAt', limit),
  };
}

/**
 * 冷门知识查询（PRD 3.5）：按综合活跃时间 lastActiveAt = max(updatedAt, lastViewedAt)
 * 从早到晚排序，最久未操作的排在最前。
 * @returns {Array} 排序后的条目（每项附 activeAt）
 */
export function coldCards(entries) {
  return [...entries]
    .map((e) => ({
      ...e,
      activeAt: new Date(cardActiveTime(e)).toISOString(),
    }))
    .sort((a, b) => Date.parse(a.activeAt) - Date.parse(b.activeAt));
}

/** ISO 时间 → 相对时间文本（刚刚 / N 分钟前 / N 小时前 / N 天前 / 日期） */
export function fmtAgo(iso, now = Date.now()) {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return '';
  const diff = now - t;
  if (diff < 60e3) return '刚刚';
  const minutes = Math.floor(diff / 60e3);
  if (minutes < 60) return `${minutes} 分钟前`;
  const hours = Math.floor(diff / 3600e3);
  if (hours < 24) return `${hours} 小时前`;
  const days = Math.floor(diff / 86400e3);
  if (days < 30) return `${days} 天前`;
  const d = new Date(t);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(
    d.getDate()
  ).padStart(2, '0')}`;
}

/** ISO 时间 → 本地完整时间文本（如 2026-09-08 21:30:00） */
export function fmtDateTime(iso) {
  if (!isValidIso(iso)) return '—';
  try {
    return new Date(iso).toLocaleString('zh-CN', { hour12: false });
  } catch {
    return iso;
  }
}

/** ISO 时间距今天数（向下取整，最小 0），用于冷门知识展示 */
export function daysSince(iso, now = Date.now()) {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return 0;
  return Math.max(0, Math.floor((now - t) / 86400e3));
}
