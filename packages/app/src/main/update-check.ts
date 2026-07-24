import { isTrustedReleaseUrl } from './external-url';
import type { UpdateCheckResult } from '../shared/update-types';

export const LATEST_RELEASE_API = 'https://api.github.com/repos/fanbuz/codesucker/releases/latest';
export const UPDATE_CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const MAX_RESPONSE_BYTES = 1024 * 1024;

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

interface SemVer {
  major: number;
  minor: number;
  patch: number;
  prerelease: Array<string | number>;
}

interface GitHubRelease {
  tag_name: string;
  html_url: string;
  published_at?: string | null;
  body?: string | null;
  draft?: boolean;
  prerelease?: boolean;
}

export interface UpdateCheckerOptions {
  currentVersion: string;
  fetcher: FetchLike;
  now?: () => number;
  cacheTtlMs?: number;
  timeoutMs?: number;
}

export function createFallbackFetcher(
  primary: FetchLike,
  secondary: FetchLike,
  primaryTimeoutMs = 7000,
): FetchLike {
  return async (input, init = {}) => {
    const controller = new AbortController();
    const abortPrimary = () => controller.abort(init.signal?.reason);
    init.signal?.addEventListener('abort', abortPrimary, { once: true });
    const timer = setTimeout(() => controller.abort('primary update transport timeout'), primaryTimeoutMs);
    try {
      return await primary(input, { ...init, signal: controller.signal });
    } catch (error) {
      if (init.signal?.aborted) throw error;
      return secondary(input, init);
    } finally {
      clearTimeout(timer);
      init.signal?.removeEventListener('abort', abortPrimary);
    }
  };
}

function parseVersion(input: string): SemVer | null {
  const normalized = input.trim().replace(/^v/i, '').split('+', 1)[0];
  const match = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/.exec(normalized);
  if (!match) return null;
  const prerelease = match[4]
    ? match[4].split('.').map((part) => /^\d+$/.test(part) ? Number.parseInt(part, 10) : part)
    : [];
  return {
    major: Number.parseInt(match[1], 10),
    minor: Number.parseInt(match[2], 10),
    patch: Number.parseInt(match[3], 10),
    prerelease,
  };
}

export function normalizeVersion(input: string): string | null {
  const version = parseVersion(input);
  if (!version) return null;
  const base = `${version.major}.${version.minor}.${version.patch}`;
  return version.prerelease.length > 0 ? `${base}-${version.prerelease.join('.')}` : base;
}

export function compareVersions(left: string, right: string): number {
  const a = parseVersion(left);
  const b = parseVersion(right);
  if (!a || !b) throw new Error('Invalid version format');
  for (const key of ['major', 'minor', 'patch'] as const) {
    if (a[key] !== b[key]) return a[key] > b[key] ? 1 : -1;
  }
  if (a.prerelease.length === 0 || b.prerelease.length === 0) {
    return a.prerelease.length === b.prerelease.length ? 0 : a.prerelease.length === 0 ? 1 : -1;
  }
  const length = Math.max(a.prerelease.length, b.prerelease.length);
  for (let index = 0; index < length; index++) {
    const av = a.prerelease[index];
    const bv = b.prerelease[index];
    if (av === undefined || bv === undefined) return av === undefined ? -1 : 1;
    if (av === bv) continue;
    if (typeof av === 'number' && typeof bv === 'number') return av > bv ? 1 : -1;
    if (typeof av === 'number') return -1;
    if (typeof bv === 'number') return 1;
    return av > bv ? 1 : -1;
  }
  return 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseRelease(value: unknown): GitHubRelease {
  if (!isRecord(value) || typeof value.tag_name !== 'string' || typeof value.html_url !== 'string') {
    throw new Error('Invalid GitHub Release response format');
  }
  const version = parseVersion(value.tag_name);
  if (!version) throw new Error('Invalid GitHub Release version format');
  if (value.draft === true || value.prerelease === true || version.prerelease.length > 0) {
    throw new Error('Latest Release is not a formal release');
  }
  if (!isTrustedReleaseUrl(value.html_url)) throw new Error('Invalid GitHub Release download URL');
  return {
    tag_name: value.tag_name,
    html_url: value.html_url,
    published_at: typeof value.published_at === 'string' ? value.published_at : null,
    body: typeof value.body === 'string' ? value.body : null,
    draft: value.draft === true,
    prerelease: value.prerelease === true,
  };
}

function summarizeNotes(markdown: string | null | undefined): string[] {
  if (!markdown) return [];
  return markdown.split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith('#'))
    .map((line) => line
      .replace(/^[-*+]\s+/, '')
      .replace(/\[([^\]]+)]\([^)]+\)/g, '$1')
      .replace(/[`*_~]/g, '')
      .replace(/<[^>]+>/g, '')
      .trim())
    .filter(Boolean)
    .slice(0, 3)
    .map((line) => line.length > 140 ? `${line.slice(0, 137)}…` : line);
}

function userMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  if (/AbortError|aborted|timeout/i.test(message)) return 'Connection to GitHub timed out, please try again later';
  if (/403|rate limit/i.test(message)) return 'GitHub request rate limit exceeded, please try again later';
  if (/404/.test(message)) return 'No formal Release found';
  if (/fetch|network|ENOTFOUND|ECONN/i.test(message)) return 'Unable to connect to GitHub, please check your network and try again';
  return message || 'Check update failed, please try again later';
}

export async function checkLatestRelease(
  currentVersion: string,
  fetcher: FetchLike,
  options: { now?: () => number; timeoutMs?: number } = {},
): Promise<UpdateCheckResult> {
  const now = options.now ?? Date.now;
  const checkedAt = new Date(now()).toISOString();
  const normalizedCurrent = normalizeVersion(currentVersion);
  if (!normalizedCurrent) {
    return { status: 'error', currentVersion, checkedAt, message: 'Current app version format is invalid', fromCache: false };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort('update check timeout'), options.timeoutMs ?? 8000);
  try {
    const response = await fetcher(LATEST_RELEASE_API, {
      method: 'GET',
      headers: {
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        'User-Agent': `CodeSucker/${normalizedCurrent}`,
      },
      cache: 'no-store',
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`GitHub API ${response.status}`);
    const contentLength = Number.parseInt(response.headers.get('content-length') ?? '0', 10);
    if (Number.isFinite(contentLength) && contentLength > MAX_RESPONSE_BYTES) throw new Error('GitHub Release response too large');
    const text = await response.text();
    if (text.length > MAX_RESPONSE_BYTES) throw new Error('GitHub Release response too large');
    const release = parseRelease(JSON.parse(text));
    const latestVersion = normalizeVersion(release.tag_name);
    if (!latestVersion) throw new Error('Invalid GitHub Release version format');

    return {
      status: compareVersions(latestVersion, normalizedCurrent) > 0 ? 'available' : 'up-to-date',
      currentVersion: normalizedCurrent,
      latestVersion,
      releaseUrl: release.html_url,
      publishedAt: release.published_at ?? null,
      notes: summarizeNotes(release.body),
      checkedAt,
      fromCache: false,
    };
  } catch (error) {
    return { status: 'error', currentVersion: normalizedCurrent, checkedAt, message: userMessage(error), fromCache: false };
  } finally {
    clearTimeout(timer);
  }
}

export function createUpdateChecker(options: UpdateCheckerOptions) {
  const now = options.now ?? Date.now;
  const cacheTtlMs = options.cacheTtlMs ?? UPDATE_CACHE_TTL_MS;
  let cached: { result: Exclude<UpdateCheckResult, { status: 'error' }>; expiresAt: number } | null = null;
  let inFlight: Promise<UpdateCheckResult> | null = null;

  return async (force = false): Promise<UpdateCheckResult> => {
    if (!force && cached && cached.expiresAt > now()) return { ...cached.result, fromCache: true };
    if (inFlight) return inFlight;
    inFlight = checkLatestRelease(options.currentVersion, options.fetcher, { now, timeoutMs: options.timeoutMs })
      .then((result) => {
        if (result.status !== 'error') cached = { result, expiresAt: now() + cacheTtlMs };
        return result;
      })
      .finally(() => { inFlight = null; });
    return inFlight;
  };
}
