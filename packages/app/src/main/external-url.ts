const TRUSTED_EXTERNAL_URLS = new Set([
  'https://github.com/fanbuz',
  'https://github.com/fanbuz/codesucker',
  'https://github.com/fanbuz/codesucker/blob/main/LICENSE',
  'https://github.com/fanbuz/mochi-issue-flow-skill',
]);

const RELEASE_TAG_PATH_PREFIX = '/fanbuz/codesucker/releases/tag/';

export function isTrustedReleaseUrl(input: string): boolean {
  try {
    const url = new URL(input);
    if (url.protocol !== 'https:' || url.hostname !== 'github.com' || url.port || url.username || url.password) return false;
    if (url.search || url.hash) return false;
    if (!url.pathname.startsWith(RELEASE_TAG_PATH_PREFIX)) return false;

    const tag = decodeURIComponent(url.pathname.slice(RELEASE_TAG_PATH_PREFIX.length));
    return /^[A-Za-z0-9._+-]+$/.test(tag);
  } catch {
    return false;
  }
}

export function isTrustedExternalUrl(input: string): boolean {
  return TRUSTED_EXTERNAL_URLS.has(input) || isTrustedReleaseUrl(input);
}
