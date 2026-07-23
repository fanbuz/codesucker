const TRUSTED_EXTERNAL_URLS = new Set([
  'https://github.com/fanbuz',
  'https://github.com/fanbuz/codesucker',
  'https://github.com/fanbuz/codesucker/blob/main/LICENSE',
  'https://github.com/fanbuz/mochi-issue-flow-skill',
]);

export function isTrustedReleaseUrl(input: string): boolean {
  try {
    const url = new URL(input);
    if (url.protocol !== 'https:' || url.hostname !== 'github.com' || url.port || url.username || url.password) return false;
    if (url.search || url.hash) return false;
    return /^\/fanbuz\/codesucker\/releases\/tag\/[A-Za-z0-9._-]+$/.test(url.pathname);
  } catch {
    return false;
  }
}

export function isTrustedExternalUrl(input: string): boolean {
  return TRUSTED_EXTERNAL_URLS.has(input) || isTrustedReleaseUrl(input);
}
