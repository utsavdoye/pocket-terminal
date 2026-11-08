// Byte helpers for the tools: a file size in words ("1.2 MB"), and base64 to bytes and back.

export const fmtSize = (n) => n == null ? '' : n < 1024 ? `${n} B` : n < 1048576 ? `${(n / 1024).toFixed(n < 10240 ? 1 : 0)} KB` : n < 1073741824 ? `${(n / 1048576).toFixed(1)} MB` : `${(n / 1073741824).toFixed(1)} GB`;
export const b64ToBytes = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
export function bytesToB64(u8) { let s = ''; for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000)); return btoa(s); }
export const b64uToBytes = (s) => { s = s.replace(/-/g, '+').replace(/_/g, '/'); return Uint8Array.from(atob(s + '==='.slice((s.length + 3) % 4)), (c) => c.charCodeAt(0)); };
export const sameBytes = (a, b) => a.length === b.length && a.every((x, i) => x === b[i]);
