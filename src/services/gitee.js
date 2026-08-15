/**
 * Gitee API v5 封装：仓库信息查询、文件读写。
 * 所有请求均携带私人令牌（access_token），仅用于访问用户自己的仓库。
 */

const API_BASE = 'https://gitee.com/api/v5';
const CONFIG_KEY = 'toolbox.giteeConfig';

/** 自定义错误：携带 Gitee 返回的错误信息 */
export class GiteeApiError extends Error {
  constructor(message, status) {
    super(message);
    this.name = 'GiteeApiError';
    this.status = status;
  }
}

/** 读取本地保存的 Gitee 配置（未配置返回 null） */
export function getGiteeConfig() {
  try {
    const raw = localStorage.getItem(CONFIG_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

/** 保存 Gitee 配置到 localStorage */
export function saveGiteeConfig(config) {
  localStorage.setItem(CONFIG_KEY, JSON.stringify(config));
}

/** 清除 Gitee 配置 */
export function clearGiteeConfig() {
  localStorage.removeItem(CONFIG_KEY);
}

/** 解析 Gitee 错误响应中的 message 字段 */
async function parseError(res) {
  try {
    const data = await res.json();
    return data?.message || `请求失败（HTTP ${res.status}）`;
  } catch {
    return `请求失败（HTTP ${res.status}）`;
  }
}

/**
 * 查询仓库信息（用于"测试连接"），返回默认分支。
 * @returns {Promise<{ defaultBranch: string, fullName: string }>}
 */
export async function getRepoInfo(owner, repo, token) {
  const res = await fetch(
    `${API_BASE}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}?access_token=${encodeURIComponent(token)}`
  );
  if (!res.ok) {
    throw new GiteeApiError(await parseError(res), res.status);
  }
  const data = await res.json();
  return {
    defaultBranch: data.default_branch,
    fullName: data.full_name,
  };
}

/**
 * 读取仓库文件内容。文件不存在时返回 null（不抛错）。
 * @returns {Promise<{ sha: string, content: string } | null>}
 */
export async function readRepoFile(owner, repo, token, path, branch) {
  const url = `${API_BASE}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/contents/${path}?access_token=${encodeURIComponent(token)}&ref=${encodeURIComponent(branch)}`;
  const res = await fetch(url);
  if (res.status === 404) return null; // 文件/目录不存在，视为首次使用
  if (!res.ok) {
    throw new GiteeApiError(await parseError(res), res.status);
  }
  const data = await res.json();
  return { sha: data.sha, content: base64ToUtf8(data.content) };
}

/**
 * 写入仓库文件：已存在则更新（需要 sha），不存在则创建（父目录自动创建）。
 * 并发冲突（sha 过期）时自动重试一次。
 */
export async function writeRepoFile(owner, repo, token, path, content, branch, message) {
  for (let attempt = 0; attempt < 2; attempt++) {
    const existing = await readRepoFile(owner, repo, token, path, branch);
    const body = {
      access_token: token,
      content: utf8ToBase64(content),
      message,
    };
    if (existing) body.sha = existing.sha;

    const res = await fetch(
      `${API_BASE}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/contents/${path}`,
      {
        method: existing ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      }
    );
    if (res.ok) return;
    // 仅当 sha 冲突（409）时重试一次
    if (res.status !== 409 || attempt === 1) {
      throw new GiteeApiError(await parseError(res), res.status);
    }
  }
}

/** UTF-8 字符串 → Base64 */
function utf8ToBase64(str) {
  const bytes = new TextEncoder().encode(str);
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary);
}

/** Base64 → UTF-8 字符串 */
function base64ToUtf8(base64) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}
