/**
 * 周期记录工具的存档存储。
 *
 * 分层存储策略：
 * 1. Gitee 仓库（主存档）：完整日历数据保存在配置仓库的
 *    history/cycle-tracker/data.json（与操作历史 history.json 并列），每次进入工具时读取；
 * 2. 浏览器 localStorage（离线缓存）：数据变更即时写本地，Gitee 读取失败时回退使用，
 *    与云端结构一致（key 为 cycleTracker:v1）。
 *
 * 数据结构：
 * {
 *   version: 1,
 *   calendars: [
 *     {
 *       id, name, createdAt,
 *       events:  [{ id, name, color, createdAt }],            // 事件定义（如「生理期」+ 颜色）
 *       records: [{ date: 'YYYY-MM-DD', eventId }],           // 事件发生记录，date+eventId 唯一
 *     },
 *   ],
 * }
 */
import { getGiteeConfig, readRepoFile, writeRepoFile } from '../../services/gitee';

const STORAGE_KEY = 'cycleTracker:v1';
const BACKUP_KEY = 'cycleTracker:v1:corrupt-backup';

/** Gitee 仓库中的存档文件路径（与使用历史 history.json 同目录并列） */
const ARCHIVE_PATH = 'history/cycle-tracker/data.json';

/** 生成唯一 id（优先使用 crypto.randomUUID） */
export function genId() {
  if (globalThis.crypto?.randomUUID) return crypto.randomUUID();
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/** 读取本地数据；损坏时自动备份原内容并重建为空数据，避免阻塞使用 */
export function loadData() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { calendars: [], recovered: false };
    const parsed = JSON.parse(raw);
    return {
      calendars: Array.isArray(parsed?.calendars) ? parsed.calendars : [],
      recovered: false,
    };
  } catch (err) {
    console.warn('周期记录本地数据损坏，已自动重置', err);
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) localStorage.setItem(BACKUP_KEY, raw);
    } catch {
      // 备份失败不影响重置
    }
    localStorage.removeItem(STORAGE_KEY);
    return { calendars: [], recovered: true };
  }
}

/** 保存本地数据（失败仅告警，不抛错） */
export function saveData(data) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ version: 1, calendars: data.calendars }));
    return true;
  } catch (err) {
    console.warn('周期记录本地数据保存失败', err);
    return false;
  }
}

/**
 * 校验导入的 JSON 文本是否为合法的存档结构。
 * @returns {Array} 日历数组
 * @throws 结构不合法时抛出错误
 */
export function parseImported(text) {
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error('文件不是有效的 JSON');
  }
  const calendars = parsed?.calendars;
  if (!Array.isArray(calendars)) {
    throw new Error('缺少 calendars 数组，不是本工具的存档文件');
  }
  for (const cal of calendars) {
    if (!cal || typeof cal.id !== 'string' || typeof cal.name !== 'string') {
      throw new Error('存档中某个日历缺少 id 或名称');
    }
    if (!Array.isArray(cal.events) || !Array.isArray(cal.records)) {
      throw new Error('存档中某个日历缺少 events 或 records 数组');
    }
  }
  return calendars;
}

/**
 * 从 Gitee 仓库读取工具存档（主存档，进入工具时调用）。
 * @returns {Promise<{ status: 'not-configured'|'empty'|'ok', calendars: Array }>}
 *   empty = 仓库中尚无存档（首次使用）；文件损坏时抛出错误由调用方回退本地缓存。
 */
export async function readGiteeArchive() {
  const config = getGiteeConfig();
  if (!config) return { status: 'not-configured', calendars: [] };
  const file = await readRepoFile(config.owner, config.repo, config.token, ARCHIVE_PATH, config.branch);
  if (!file) return { status: 'empty', calendars: [] };
  try {
    return { status: 'ok', calendars: parseImported(file.content) };
  } catch (err) {
    throw new Error(`Gitee 存档内容无效：${err.message}`);
  }
}

/**
 * 将完整日历数据写入 Gitee 仓库存档（文件不存在时自动创建）。
 * @returns {Promise<{ status: 'not-configured'|'ok' }>}
 */
export async function writeGiteeArchive(calendars) {
  const config = getGiteeConfig();
  if (!config) return { status: 'not-configured' };
  await writeRepoFile(
    config.owner,
    config.repo,
    config.token,
    ARCHIVE_PATH,
    JSON.stringify({ version: 1, calendars }, null, 2),
    config.branch,
    '更新周期记录与预测存档'
  );
  return { status: 'ok' };
}
