export {};

declare global {
  const __APP_VERSION__: string;

  interface Window {
    cs: {
      win: (action: 'minimize' | 'maximize' | 'close') => void;
      pickFolder: () => Promise<string | null>;
      pickOutDir: () => Promise<string | null>;
      recentList: () => Promise<unknown>;
      scan: (root: string) => Promise<unknown>;
      process: (payload: unknown) => Promise<unknown>;
      export: (payload: unknown) => Promise<unknown>;
      saveConfig: (root: string, config: unknown) => Promise<boolean>;
      showItem: (p: string) => Promise<void>;
    };
  }
}
