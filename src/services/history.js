/**
 * 工具使用历史记录服务。
 * 数据存储在用户配置的 Gitee 仓库中，按工具分目录存档：
 *   history/<toolId>/history.json
 * 每个存档保留最近 MAX_RECORDS（20）条记录，超出部分自动删除。
 * 首次使用某工具时仓库中不存在存档：不报错，自动创建（写入即建目录）。
 */
import {
  getGiteeConfig,
  readRepoFile,
  writeRepoFile,
} from './gitee';

const MAX_RECORDS = 20;
const HISTORY_DIR = 'history';
const FILE_NAME = 'history.json';

/** 由工具注册路径推导存档目录名，如 /tools/png-alpha-normalize → png-alpha-normalize */
export function toolIdFromPath(path) {
  return path.split('/').filter(Boolean).pop();
}

/** 是否已配置 Gitee 仓库 */
export function isGiteeConfigured() {
  return Boolean(getGiteeConfig());
}

/**
 * 读取某工具的历史记录。
 * 未配置 Gitee → 返回 null；存档不存在（首次使用）→ 返回空记录，不报错。
 * @returns {Promise<{ records: Array, exists: boolean } | null>}
 */
export async function getToolHistory(toolId) {
  const config = getGiteeConfig();
  if (!config) return null;

  const path = `${HISTORY_DIR}/${toolId}/${FILE_NAME}`;
  const file = await readRepoFile(config.owner, config.repo, config.token, path, config.branch);
  if (!file) return { records: [], exists: false };

  try {
    const data = JSON.parse(file.content);
    return { records: Array.isArray(data.records) ? data.records : [], exists: true };
  } catch {
    // 存档内容损坏时按空记录处理，避免阻塞工具使用
    return { records: [], exists: true };
  }
}

/**
 * 记录一次工具使用（新记录插入头部，保留最近 20 条）。
 * 存档不存在时自动创建（首次使用）。
 * @param {string} toolId 工具存档目录名
 * @param {object} entry 记录内容（不含 time，time 自动生成）
 * @returns {Promise<{ recorded: boolean, reason?: string }>}
 */
export async function recordToolUsage(toolId, entry) {
  const config = getGiteeConfig();
  if (!config) return { recorded: false, reason: 'not-configured' };

  const path = `${HISTORY_DIR}/${toolId}/${FILE_NAME}`;
  const file = await readRepoFile(config.owner, config.repo, config.token, path, config.branch);

  const records = file ? JSON.parse(file.content).records : [];
  records.unshift({
    time: new Date().toISOString(),
    ...entry,
  });
  const trimmed = records.slice(0, MAX_RECORDS);

  await writeRepoFile(
    config.owner,
    config.repo,
    config.token,
    path,
    JSON.stringify({ records: trimmed }, null, 2),
    config.branch,
    `记录 ${toolId} 使用历史`
  );
  return { recorded: true };
}
