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
 * 读取仓库文件并返回原始响应内容（文本与二进制读取共用）。
 * 文件不存在时返回 null（不抛错，由调用方按“首次使用”处理）。
 * 实测：Gitee 对“文件/分支不存在”返回 HTTP 200 + 空数组（而非 404），
 * 此处兼容两种形态；若路径对应的是目录（非空数组），抛出可操作的错误。
 * @returns {Promise<{ sha: string, content: string } | null>}（content 为原始 base64）
 */
async function fetchRepoFileContent(owner, repo, token, path, branch) {
  const url = `${API_BASE}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/contents/${path}?access_token=${encodeURIComponent(token)}&ref=${encodeURIComponent(branch)}`;
  // cache: no-store：每次进入工具都必须读到仓库最新状态，避免 HTTP 缓存把已存在的文件误判为“不存在”
  const res = await fetch(url, { cache: 'no-store' });
  if (res.status === 404) return null; // 仓库或文件不存在
  if (!res.ok) {
    throw new GiteeApiError(await parseError(res), res.status);
  }
  let data;
  try {
    data = await res.json();
  } catch {
    throw new GiteeApiError(`Gitee 返回了无法解析的响应（HTTP ${res.status}）`, res.status);
  }
  if (Array.isArray(data)) {
    if (data.length === 0) return null; // 文件/分支不存在，视为首次使用
    // 非空数组 = 该路径在仓库中是一个目录而非存档文件
    throw new GiteeApiError(`仓库中「${path}」是一个文件夹而非存档文件，请删除该文件夹后重试`, res.status);
  }
  if (typeof data?.content !== 'string') {
    throw new GiteeApiError(
      `读取「${path}」时 Gitee 响应缺少文件内容${data?.message ? `：${data.message}` : ''}，请检查仓库与分支配置`,
      res.status
    );
  }
  return { sha: data.sha, content: data.content };
}

/**
 * 读取仓库文本文件。文件不存在时返回 null。
 * @returns {Promise<{ sha: string, content: string } | null>}
 */
export async function readRepoFile(owner, repo, token, path, branch) {
  const file = await fetchRepoFileContent(owner, repo, token, path, branch);
  return file ? { sha: file.sha, content: base64ToUtf8(file.content) } : null;
}

/**
 * 读取仓库二进制文件（如图片），文件不存在时返回 null。
 * @returns {Promise<{ sha: string, bytes: Uint8Array } | null>}
 */
export async function readRepoFileBinary(owner, repo, token, path, branch) {
  const file = await fetchRepoFileContent(owner, repo, token, path, branch);
  return file ? { sha: file.sha, bytes: base64ToBytes(file.content) } : null;
}

/**
 * 删除仓库文件。文件不存在视为已删除（返回 false，不抛错）。
 * @returns {Promise<boolean>} 是否执行了删除
 */
export async function deleteRepoFile(owner, repo, token, path, branch, message) {
  const file = await fetchRepoFileContent(owner, repo, token, path, branch);
  if (!file) return false;
  const body = new URLSearchParams();
  body.set('access_token', token);
  body.set('sha', file.sha);
  body.set('message', message ?? '清理工具存档');
  if (branch) body.set('branch', branch);
  const res = await fetch(
    `${API_BASE}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/contents/${path}`,
    {
      method: 'DELETE',
      cache: 'no-store',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8' },
      body: body.toString(),
    }
  );
  if (res.ok) return true;
  throw new GiteeApiError(await parseError(res), res.status);
}

/**
 * 写入仓库文件：已存在则更新（需要 sha），不存在则创建（父目录自动创建）。
 * Gitee v5 写接口按表单参数解析，content/sha 放在请求体中；
 * branch 仅在存在时携带（与读取的 ref 保持一致，分支错误时立即显式报错而非静默写错分支）。
 * 并发冲突（sha 过期）时自动重试一次。
 */
export async function writeRepoFile(owner, repo, token, path, content, branch, message) {
  for (let attempt = 0; attempt < 2; attempt++) {
    const existing = await readRepoFile(owner, repo, token, path, branch);
    const body = new URLSearchParams();
    body.set('access_token', token);
    body.set('content', contentToBase64(content));
    body.set('message', message);
    if (branch) body.set('branch', branch);
    if (existing) body.set('sha', existing.sha);

    const res = await fetch(
      `${API_BASE}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/contents/${path}`,
      {
        method: existing ? 'PUT' : 'POST',
        cache: 'no-store',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8' },
        body: body.toString(),
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

/**
 * 写入内容 → Base64：支持字符串（UTF-8 文本）与 Uint8Array/ArrayBuffer（二进制，如图片）。
 * 分块拼接避免大文件时逐字节字符串拼接过慢。
 */
function contentToBase64(content) {
  if (typeof content === 'string') return utf8ToBase64(content);
  const bytes = content instanceof Uint8Array ? content : new Uint8Array(content);
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary);
}

/** Base64 → 字节数组（兼容 RFC 2045 换行格式） */
function base64ToBytes(base64) {
  const cleaned = base64.replace(/\s/g, '');
  const binary = atob(cleaned);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/** Base64 → UTF-8 字符串 */
function base64ToUtf8(base64) {
  return new TextDecoder().decode(base64ToBytes(base64));
}
