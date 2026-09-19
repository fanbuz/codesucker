/** 经主进程校验后可恢复到界面的项目偏好；不包含内部扫描报告。 */
export interface ProjectConfigValues {
  title?: string;
  owner?: string;
  sortMode?: 'entry' | 'mtime' | 'manual';
  order?: string[];
  excludedRelPaths?: string[];
  clean?: ProjectCleanToggles;
  fmtDocx?: boolean;
  fmtTxt?: boolean;
  outDir?: string;
  thirdPartyRisk: { rulesVersion: string; keptFindingIds: string[] };
}

export interface ProjectCleanToggles {
  removeComments: boolean;
  removeBlankLines: boolean;
  maskSensitive: boolean;
  wrapLongLines: boolean;
}

export const DEFAULT_PROJECT_CLEAN: Readonly<ProjectCleanToggles> = {
  removeComments: true,
  removeBlankLines: true,
  maskSensitive: true,
  wrapLongLines: true,
};
