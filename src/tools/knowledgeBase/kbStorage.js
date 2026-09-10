/**
 * 个人知识库 - 本地缓存与 Gitee 存档读写。
 *
 * 分层存储策略（与周期记录工具一致）：
 * 1. Gitee 仓库（主存档）：目录 history/knowledge-base/，索引 + 按分类拆分的 JSON 文件，
 *    每次进入工具时拉取，任何内容变更自动推送（文件级 diff，由入口组件调度）；
 * 2. 浏览器 localStorage（离线缓存）：整库一份（key 为 knowledgeBase:v1），结构同内存态，
 *    Gitee 不可用时回退使用。
 *
 * 云端目录结构：
 *   history/knowledge-base/index.json         → { version, defaultCategoryId, categories: [{id,name}] }
 *   history/knowledge-base/<分类名>.json      → { category, version, updatedAt, cards: [...] }
 *     默认分类「未分类」固定对应 default.json；卡片序列化时自动补全 category 字段。
 */
import {
  getGiteeConfig,
  readRepoFile,
  writeRepoFile,
  deleteRepoFile,
} from '../../services/gitee';
import {
  getCategoryFileName,
  makeEmptyState,
  repairState,
  sortCardsForStore,
} from './kbCore';

const STORAGE_KEY = 'knowledgeBase:v1';
/** 本地数据损坏时备份原始内容（单值字符串） */
const CORRUPT_KEY = 'knowledgeBase:v1:corrupt-backup';
/** 云端某分类文件损坏时的原始内容备份（fileName → 原始字符串） */
const CLOUD_CORRUPT_KEY = 'knowledgeBase:v1:cloud-corrupt-backup';

const KB_DIR = 'history/knowledge-base';
const INDEX_FILE = 'index.json';

/** 存档目录中某文件的完整路径 */
export function kbArchivePath(fileName) {
  return `${KB_DIR}/${fileName}`;
}

/**
 * 读取本地缓存。损坏时自动备份原内容并重建空库，避免阻塞使用。
 * @returns {{ state: object, recovered: boolean }}
 */
export function loadLocal() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { state: makeEmptyState(), recovered: false };
    return { state: repairState(JSON.parse(raw)), recovered: false };
  } catch (err) {
    console.warn('个人知识库本地数据损坏，已自动重置', err);
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) localStorage.setItem(CORRUPT_KEY, raw);
    } catch {
      // 备份失败不影响重置
    }
    localStorage.removeItem(STORAGE_KEY);
    return { state: makeEmptyState(), recovered: true };
  }
}

/** 保存本地缓存（失败仅告警，不抛错） */
export function saveLocal(state) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    return true;
  } catch (err) {
    console.warn('个人知识库本地数据保存失败', err);
    return false;
  }
}

/**
 * 将内存态序列化为云端各文件的文本内容（含 lastViewedAt 等全部字段）。
 * 卡片按综合活跃时间排序存储（PRD 3.5），写文件时该分类文件的 updatedAt 取序列化时刻。
 * @param {object} state
 * @returns {Object<string, string>} fileName → 文件内容文本
 */
export function buildFiles(state) {
  const index = {
    version: 1,
    defaultCategoryId: state.defaultCategoryId,
    categories: state.categories.map(({ id, name }) => ({ id, name })),
  };
  const files = { [INDEX_FILE]: JSON.stringify(index, null, 2) };
  const nowIso = new Date().toISOString();
  for (const cat of state.categories) {
    const fileName = getCategoryFileName(cat.name);
    const cards = sortCardsForStore(cat.cards).map((c) => ({
      ...c,
      category: cat.name, // 分类文件内补全卡片 category 字段（读入时忽略）
    }));
    files[fileName] = JSON.stringify(
      { category: cat.name, version: 1, updatedAt: nowIso, cards },
      null,
      2
    );
  }
  return files;
}

/** 仅计算内容键（忽略 lastViewedAt 等纯本地增强信息），用于判断是否需要推送云端 */
export function contentKey(state) {
  return JSON.stringify(
    state.categories.map((cat) => ({
      name: cat.name,
      cards: cat.cards.map(({ lastViewedAt, ...rest }) => rest),
    }))
  );
}

/**
 * 备份云端某文件损坏时的原始内容到 localStorage（多个文件以对象累积保存）。
 * @param {string} fileName
 * @param {string} raw
 */
export function backupCorruptCloudFile(fileName, raw) {
  try {
    const map = JSON.parse(localStorage.getItem(CLOUD_CORRUPT_KEY) ?? '{}');
    map[fileName] = raw;
    localStorage.setItem(CLOUD_CORRUPT_KEY, JSON.stringify(map));
  } catch {
    // 备份失败仅告警，不阻断流程
    console.warn('知识库云端损坏文件备份失败', fileName);
  }
}

/**
 * 从 Gitee 仓库读取完整知识库（索引 + 各分类文件）。
 * @returns {Promise<{
 *   status: 'not-configured'|'empty'|'ok',
 *   state: object|null,          // empty/not-configured 时为 null
 *   rawFiles: Object<string,string>, // 成功/损坏读到的文件原文（作为同步基线）
 *   warnings: Array,             // [{ fileName, kind: 'missing'|'corrupt' }]
 * }>}
 * index.json 本身缺失视为首次使用（empty）；其内容损坏时抛出错误由调用方降级本地。
 */
export async function readGiteeLibrary() {
  const config = getGiteeConfig();
  if (!config) return { status: 'not-configured', state: null, rawFiles: {}, warnings: [] };

  const readFile = (fileName) =>
    readRepoFile(config.owner, config.repo, config.token, kbArchivePath(fileName), config.branch);

  const rawIndex = await readFile(INDEX_FILE);
  if (!rawIndex) return { status: 'empty', state: null, rawFiles: {}, warnings: [] };

  let index;
  try {
    index = JSON.parse(rawIndex.content);
  } catch (err) {
    throw new Error(
      `Gitee 知识库索引文件（${KB_DIR}/${INDEX_FILE}）内容无效：${err.message}。` +
        '请先在页面中导出备份，再前往 Gitee 检查该文件；修复或删除后重新进入本工具。'
    );
  }
  if (!Array.isArray(index.categories) || typeof index.defaultCategoryId !== 'string') {
    throw new Error(
      `Gitee 知识库索引文件（${KB_DIR}/${INDEX_FILE}）结构异常：缺少 categories 或 defaultCategoryId。` +
        '请先在页面中导出备份，再前往 Gitee 检查该文件。'
    );
  }

  const rawFiles = { [INDEX_FILE]: rawIndex.content };
  const warnings = [];
  const cats = [];
  for (const rawCat of index.categories) {
    const cat = {
      id: rawCat?.id ?? '',
      name: rawCat?.name ?? '',
      cards: [],
    };
    if (!cat.id || !cat.name) continue;
    const fileName = getCategoryFileName(cat.name);
    const file = await readFile(fileName);
    if (!file) {
      // 索引存在但分类文件缺失：按空分类处理，修改该分类时自动重建云端文件
      warnings.push({ fileName, kind: 'missing' });
      cats.push(cat);
      continue;
    }
    rawFiles[fileName] = file.content;
    try {
      const data = JSON.parse(file.content);
      if (!Array.isArray(data?.cards)) {
        throw new Error('缺少 cards 数组');
      }
      cat.cards = data.cards;
    } catch (err) {
      // 分类文件损坏：备份原文后按空分类处理，编辑该分类时写入将自动覆盖修复
      console.warn('知识库云端分类文件损坏', fileName, err);
      backupCorruptCloudFile(fileName, file.content);
      warnings.push({ fileName, kind: 'corrupt' });
    }
    cats.push(cat);
  }

  return {
    status: 'ok',
    state: repairState({ version: 1, defaultCategoryId: index.defaultCategoryId, categories: cats }),
    rawFiles,
    warnings,
  };
}

/** 写入单个知识库文件（不存在则创建，存在则按 sha 更新；未配置 Gitee 时抛错） */
export async function writeKbFile(fileName, content) {
  const config = getGiteeConfig();
  if (!config) throw new Error('尚未配置 Gitee 仓库');
  await writeRepoFile(
    config.owner,
    config.repo,
    config.token,
    kbArchivePath(fileName),
    content,
    config.branch,
    '更新个人知识库存档'
  );
}

/** 删除单个知识库文件（不存在视为已删除）；未配置 Gitee 时抛错 */
export async function deleteKbFile(fileName) {
  const config = getGiteeConfig();
  if (!config) throw new Error('尚未配置 Gitee 仓库');
  await deleteRepoFile(
    config.owner,
    config.repo,
    config.token,
    kbArchivePath(fileName),
    config.branch,
    '清理个人知识库文件'
  );
}

/**
 * 校验导入的 JSON 文本（导出文件或整库备份）并规范化为内存态。
 * @returns {object} 规范化后的知识库状态
 * @throws 结构不合法时抛出错误
 */
export function parseImported(text) {
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error('文件不是有效的 JSON');
  }
  if (!parsed || !Array.isArray(parsed.categories)) {
    throw new Error('缺少 categories 数组，不是本工具的导出文件');
  }
  return repairState(parsed);
}
