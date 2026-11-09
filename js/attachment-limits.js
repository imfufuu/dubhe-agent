// 单个附件的统一上限（2026-11-08）：16 MiB → 128 MiB。
// 大对象由 state.js 的 IndexedDB 外置机制承载（FILE_KEEP=16 KiB），不占 localStorage 5 MiB 配额。
export const ATTACHMENT_MAX_BYTES = 128 * 1024 * 1024;
export const ATTACHMENT_MAX_MB = 128;
export function attachmentLimitLabel() { return '128MB'; }
