/**
 * 借贷账簿 - 本地缓存与 Gitee 存档读写。
 *
 * 分层存储策略（与周期记录工具一致）：
 * 1. Gitee 仓库（主存档）：完整账簿数据保存在配置仓库的
 *    history/loan-ledger/data.json（与使用历史 history.json 并列），每次进入工具时读取；
 * 2. 浏览器 localStorage（离线缓存）：数据变更即时写本地，Gitee 读取失败时回退使用，
 *    与云端结构一致（key 为 loanLedger:v1）。
 *
 * 数据结构：
 * { version: 1, items: [ { id, lender, borrower, amount, loanDate, paymentMethod, dueDate, createdAt, updatedAt, repayments } ] }
 * （详见 loanCore.js 顶部说明）
 */
import { getGiteeConfig, readRepoFile, writeRepoFile } from '../../services/gitee';
import { makeEmptyData, parseImported, repairItems } from './loanCore';

const STORAGE_KEY = 'loanLedger:v1';
const BACKUP_KEY = 'loanLedger:v1:corrupt-backup';

/** Gitee 仓库中的存档文件路径（与使用历史 history.json 同目录并列） */
const ARCHIVE_PATH = 'history/loan-ledger/data.json';

/** 读取本地数据；损坏时自动备份原内容并重建为空数据，避免阻塞使用 */
export function loadData() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { items: [], recovered: false };
    const parsed = JSON.parse(raw);
    return { items: repairItems(parsed?.items), recovered: false };
  } catch (err) {
    console.warn('借贷账簿本地数据损坏，已自动重置', err);
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) localStorage.setItem(BACKUP_KEY, raw);
    } catch {
      // 备份失败不影响重置
    }
    localStorage.removeItem(STORAGE_KEY);
    return { items: [], recovered: true };
  }
}

/** 保存本地数据（失败仅告警，不抛错） */
export function saveData(items) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...makeEmptyData(), items }));
    return true;
  } catch (err) {
    console.warn('借贷账簿本地数据保存失败', err);
    return false;
  }
}

/**
 * 从 Gitee 仓库读取账簿存档（主存档，进入工具时调用）。
 * @returns {Promise<{ status: 'not-configured'|'empty'|'ok', items: Array }>}
 *   empty = 仓库中尚无存档（首次使用）；文件损坏时抛出错误由调用方回退本地缓存。
 */
export async function readGiteeArchive() {
  const config = getGiteeConfig();
  if (!config) return { status: 'not-configured', items: [] };
  const file = await readRepoFile(config.owner, config.repo, config.token, ARCHIVE_PATH, config.branch);
  if (!file) return { status: 'empty', items: [] };
  try {
    return { status: 'ok', items: repairItems(JSON.parse(file.content)?.items) };
  } catch (err) {
    throw new Error(`Gitee 借贷账簿存档内容无效：${err.message}`);
  }
}

/**
 * 将完整账簿数据写入 Gitee 仓库存档（文件不存在时自动创建）。
 * @returns {Promise<{ status: 'not-configured'|'ok' }>}
 */
export async function writeGiteeArchive(items) {
  const config = getGiteeConfig();
  if (!config) return { status: 'not-configured' };
  await writeRepoFile(
    config.owner,
    config.repo,
    config.token,
    ARCHIVE_PATH,
    JSON.stringify({ ...makeEmptyData(), items }, null, 2),
    config.branch,
    '更新借贷账簿存档'
  );
  return { status: 'ok' };
}

/** 校验导入的 JSON 文本（导出文件或整库备份）并返回事项数组；结构不合法时抛错 */
export function parseImportedFile(text) {
  return parseImported(text);
}
