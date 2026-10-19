export interface UpdateReleaseInfo {
  currentVersion: string;
  latestVersion: string;
  releaseUrl: string;
  publishedAt: string | null;
  notes: string[];
  checkedAt: string;
  fromCache: boolean;
}

export function supportsInAppUpdate(release: Pick<UpdateReleaseInfo, 'latestVersion' | 'releaseUrl'>): boolean {
  return /^\d+\.\d+\.\d+$/.test(release.latestVersion) &&
    release.releaseUrl === `https://github.com/fanbuz/codesucker/releases/tag/v${release.latestVersion}`;
}

export type UpdateCheckResult =
  | ({ status: 'available' | 'up-to-date' } & UpdateReleaseInfo)
  | {
      status: 'error';
      currentVersion: string;
      checkedAt: string;
      message: string;
      fromCache: false;
    };

export interface UpdateInstallState {
  phase: 'idle' | 'downloading' | 'verifying' | 'ready' | 'installing' | 'error';
  version?: string;
  received?: number;
  total?: number;
  message?: string;
}
