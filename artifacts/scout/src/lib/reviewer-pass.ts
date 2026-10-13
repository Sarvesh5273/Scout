import { setExtraHeadersGetter } from '@workspace/api-client-react';

const STORAGE_KEY = 'scout.reviewerPass';
const PASS_PATTERN = /^[A-Za-z0-9._~-]{10,128}$/;

let current: string | null = null;

function readStoredPass(): string | null {
  try {
    const value = window.localStorage.getItem(STORAGE_KEY);
    return value && PASS_PATTERN.test(value) ? value : null;
  } catch {
    return null;
  }
}

/**
 * Reviewers get a private link ending in `?pass=<code>`. The code moves from the address bar into
 * localStorage, so it isn't left in links people copy, and goes out with every API request as X-Scout-Pass.
 * The server decides whether it's valid.
 */
export function installReviewerPass(): void {
  const url = new URL(window.location.href);
  const fromUrl = url.searchParams.get('pass');
  if (fromUrl !== null) {
    url.searchParams.delete('pass');
    window.history.replaceState(window.history.state, '', `${url.pathname}${url.search}${url.hash}`);
    if (PASS_PATTERN.test(fromUrl)) {
      current = fromUrl;
      try {
        window.localStorage.setItem(STORAGE_KEY, fromUrl);
      } catch {
        // Storage blocked (some private modes): the pass still works for this visit.
      }
    }
  }
  current ??= readStoredPass();
  setExtraHeadersGetter(() => (current ? { 'x-scout-pass': current } : null));
}

export function hasReviewerPass(): boolean {
  return current !== null;
}
