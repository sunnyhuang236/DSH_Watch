// 确定性脱敏与短文本工具：M1 只在本机库中保存"标题/摘要"级别的短文本，绝不保存正文。
const DRIVE_PATH = /[A-Za-z]:[\\/][^\s"'`]+/g;
const HOME_PATH = /\/(?:Users|home|root)\/[^\s"'`]+/g;
const URL_RE = /https?:\/\/[^\s"'`]+/gi;
const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
const TOKEN_RE = /\b(sk-[A-Za-z0-9_-]{8,}|ghp_[A-Za-z0-9]{10,}|github_pat_[A-Za-z0-9_]{10,}|AKIA[A-Z0-9]{12,}|Bearer\s+[A-Za-z0-9._-]+)/g;

/**
 * 把任意文本压成安全的单行短摘要。
 * - 去换行/多余空白；替换盘符路径、家目录路径、URL、邮箱、token 特征；
 * - 超长截断并加省略号。
 * @param {unknown} value
 * @param {number} maxLen
 * @returns {string|null}
 */
export function sanitizeText(value, maxLen = 120) {
  if (typeof value !== 'string') return null;
  let text = value.replace(/[\r\n\t]+/g, ' ').replace(/\s+/g, ' ').trim();
  if (!text) return null;
  text = text
    .replace(DRIVE_PATH, '<path>')
    .replace(HOME_PATH, '<path>')
    .replace(URL_RE, '<url>')
    .replace(EMAIL_RE, '<email>')
    .replace(TOKEN_RE, '<redacted>');
  if (text.length > maxLen) text = text.slice(0, Math.max(0, maxLen - 1)) + '…';
  return text;
}

/** 从 cwd 提取最后一段作为兜底标题（例如工作区目录名）。 */
export function basenameSafe(cwd) {
  if (typeof cwd !== 'string' || !cwd) return null;
  const parts = cwd.split(/[\\/]+/).filter(Boolean);
  const last = parts[parts.length - 1];
  return last ? sanitizeText(last, 60) : null;
}

/** 只保留长度信息，用于统计（不落原文）。 */
export function lengthOf(value) {
  return typeof value === 'string' ? value.length : 0;
}
