export interface UpdateReleaseInfo {
  currentVersion: string;
  latestVersion: string;
  releaseUrl: string;
  publishedAt: string | null;
  notes: string[];
  checkedAt: string;
  fromCache: boolean;
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
