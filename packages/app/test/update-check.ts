import assert from 'node:assert/strict';
import {
  LATEST_RELEASE_API, checkLatestRelease, compareVersions, createFallbackFetcher, createUpdateChecker, normalizeVersion,
  type FetchLike,
} from '../src/main/update-check.ts';
import { isTrustedExternalUrl, isTrustedReleaseUrl } from '../src/main/external-url.ts';

function releaseResponse(patch: Record<string, unknown> = {}): Response {
  return new Response(JSON.stringify({
    tag_name: 'v0.2.0',
    html_url: 'https://github.com/fanbuz/codesucker/releases/tag/v0.2.0',
    published_at: '2026-07-23T00:00:00Z',
    body: '## Added\n- 文件类型统计\n- [下载说明](https://example.com)\n',
    draft: false,
    prerelease: false,
    ...patch,
  }), { status: 200, headers: { 'content-type': 'application/json' } });
}

assert.equal(normalizeVersion('v0.2.0'), '0.2.0');
assert.equal(normalizeVersion('0.2.0-beta.1+build.2'), '0.2.0-beta.1');
assert.equal(normalizeVersion('release-1'), null);
assert.equal(compareVersions('0.2.0', '0.1.9'), 1);
assert.equal(compareVersions('0.2.0-beta.1', '0.2.0'), -1);
assert.equal(compareVersions('0.2.0-beta.2', '0.2.0-beta.1'), 1);
assert.equal(compareVersions('0.2.0-beta.1', '0.2.0-beta.alpha'), -1);
assert.equal(compareVersions('1.0.0-A', '1.0.0-a'), -1);
assert.equal(compareVersions('1.0.0-a', '1.0.0-A'), 1);

assert.equal(isTrustedReleaseUrl('https://github.com/fanbuz/codesucker/releases/tag/v0.2.0'), true);
assert.equal(isTrustedReleaseUrl('https://github.com/fanbuz/codesucker/releases/tag/v0.2.0+win.1'), true);
assert.equal(isTrustedReleaseUrl('https://github.com/fanbuz/codesucker/releases/tag/v0.2.0%2Bwin.1'), true);
assert.equal(isTrustedReleaseUrl('https://github.com/fanbuz/codesucker/releases/tag/v0.2.0%2Fwin.1'), false);
assert.equal(isTrustedReleaseUrl('https://github.com/fanbuz/codesucker/releases/tag/v0.2.0?download=1'), false);
assert.equal(isTrustedReleaseUrl('https://evil.example/fanbuz/codesucker/releases/tag/v0.2.0'), false);
assert.equal(isTrustedExternalUrl('https://github.com/fanbuz/codesucker'), true);
assert.equal(isTrustedExternalUrl('https://github.com/fanbuz/codesucker/releases/tag/v0.2.0'), true);
assert.equal(isTrustedExternalUrl('https://github.com/fanbuz/codesucker/issues/21'), false);

const now = () => Date.parse('2026-07-23T01:00:00Z');
let requests = 0;
const fetcher: FetchLike = async (url, init) => {
  requests++;
  assert.equal(url, LATEST_RELEASE_API);
  assert.equal(init?.method, 'GET');
  assert.equal((init?.headers as Record<string, string>)['User-Agent'], 'CodeSucker/0.1.0');
  return releaseResponse();
};

async function main() {
  const available = await checkLatestRelease('0.1.0', fetcher, { now });
  assert.equal(available.status, 'available');
  if (available.status !== 'error') {
    assert.equal(available.latestVersion, '0.2.0');
    assert.deepEqual(available.notes, ['文件类型统计', '下载说明']);
  }

  const buildMetadata = await checkLatestRelease('0.1.0', async () => releaseResponse({
    tag_name: 'v0.2.0+win.1',
    html_url: 'https://github.com/fanbuz/codesucker/releases/tag/v0.2.0%2Bwin.1',
  }), { now });
  assert.equal(buildMetadata.status, 'available');
  if (buildMetadata.status !== 'error') assert.equal(buildMetadata.latestVersion, '0.2.0');

  const current = await checkLatestRelease('0.2.0', async () => releaseResponse(), { now });
  assert.equal(current.status, 'up-to-date');

  const mislabeledPrerelease = await checkLatestRelease('0.1.0', async () => releaseResponse({
    tag_name: 'v0.2.0-beta.1',
    html_url: 'https://github.com/fanbuz/codesucker/releases/tag/v0.2.0-beta.1',
    prerelease: false,
  }), { now });
  assert.equal(mislabeledPrerelease.status, 'error');
  if (mislabeledPrerelease.status === 'error') assert.match(mislabeledPrerelease.message, /formal release/i);

  const markedPrerelease = await checkLatestRelease('0.1.0', async () => releaseResponse({ prerelease: true }), { now });
  assert.equal(markedPrerelease.status, 'error');
  if (markedPrerelease.status === 'error') assert.match(markedPrerelease.message, /formal release/i);

  const invalid = await checkLatestRelease('0.1.0', async () => releaseResponse({ html_url: 'https://evil.example/release' }), { now });
  assert.equal(invalid.status, 'error');
  if (invalid.status === 'error') assert.match(invalid.message, /download URL/i);

  const limited = await checkLatestRelease('0.1.0', async () => new Response('', { status: 403 }), { now });
  assert.equal(limited.status, 'error');
  if (limited.status === 'error') assert.match(limited.message, /rate limit/i);

  const timeoutFetcher: FetchLike = async (_url, init) => new Promise((_resolve, reject) => {
    init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')), { once: true });
  });
  const timedOut = await checkLatestRelease('0.1.0', timeoutFetcher, { now, timeoutMs: 5 });
  assert.equal(timedOut.status, 'error');
  if (timedOut.status === 'error') assert.match(timedOut.message, /timed out/i);

  let secondaryRequests = 0;
  const slowPrimary: FetchLike = async (_url, init) => new Promise((_resolve, reject) => {
    init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')), { once: true });
  });
  const fallback = createFallbackFetcher(slowPrimary, async () => {
    secondaryRequests++;
    return releaseResponse();
  }, 5);
  const fallbackResult = await checkLatestRelease('0.1.0', fallback, { now, timeoutMs: 100 });
  assert.equal(fallbackResult.status, 'available');
  assert.equal(secondaryRequests, 1, '主网络栈超时后应使用 Electron 网络栈兜底');

  requests = 0;
  const checker = createUpdateChecker({ currentVersion: '0.1.0', fetcher, now, cacheTtlMs: 1000 });
  const first = await checker();
  const cached = await checker();
  assert.equal(requests, 1, '缓存期内不得重复请求 GitHub');
  assert.equal(first.fromCache, false);
  assert.equal(cached.fromCache, true);
  await checker(true);
  assert.equal(requests, 2, '手动检查应绕过缓存');

  console.log('✅ update check 全部通过');
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
