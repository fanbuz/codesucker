export interface WindowChromeOptions {
  frame: boolean;
  titleBarStyle?: 'hiddenInset';
}

/** Keep macOS window controls native while Windows/Linux retain the custom chrome. */
export function windowChromeOptions(platform: NodeJS.Platform): WindowChromeOptions {
  if (platform === 'darwin') {
    return {
      frame: true,
      titleBarStyle: 'hiddenInset',
    };
  }

  return { frame: false };
}
