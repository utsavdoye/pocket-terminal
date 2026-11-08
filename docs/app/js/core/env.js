// Facts about where the app runs, worked out once at start: the version, demo or view-only
// mode, the default message board, and what kind of phone or browser this is.

export const APP_VERSION = '7.3.1';
// Demo mode (#demo): the whole app with sample data and a pretend shell. Connects to nothing,
// and never touches this phone's real pairing, history or keys.
export const DEMO = location.hash === '#demo';
// View-only mode (#watch=…): someone shared a live view of their terminal with you.
export const VIEW = /(^#|&)watch=/.test(location.hash);
export const DEFAULT_BOARDS = ['https://ntfy.sh'];
export const ICE = [{ urls: ['stun:stun.l.google.com:19302', 'stun:stun.cloudflare.com:3478'] }];

export const okBoards = (v) => { const b = (Array.isArray(v) ? v : String(v || '').split(',')).filter((u) => /^https:\/\//.test(u) || /^http:\/\/(127\.0\.0\.1|localhost)[:/]/.test(u)); return b.length ? b : null; };
export function deviceName() {
  const ua = navigator.userAgent;
  const dev = /iPad/.test(ua) ? 'iPad' : /iPhone/.test(ua) ? 'iPhone' : /Android/.test(ua) ? 'Android phone' : /Mac/.test(ua) ? 'Mac browser' : /Windows/.test(ua) ? 'Windows browser' : 'Browser';
  const br = /CriOS|Chrome/.test(ua) && !/Edg/.test(ua) ? 'Chrome' : /FxiOS|Firefox/.test(ua) ? 'Firefox' : /Edg/.test(ua) ? 'Edge' : /Safari/.test(ua) ? 'Safari' : '';
  if (standalone) return `${dev} (app)`;
  return br ? `${dev} (${br})` : dev;
}

export const isIOS = /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
export const standalone = navigator.standalone === true || matchMedia('(display-mode: standalone)').matches;
