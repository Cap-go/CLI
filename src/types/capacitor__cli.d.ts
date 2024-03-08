// CapacitorConfig

declare module '@capacitor/cli/dist/config' {
  export function loadConfig(): CapacitorConfig
  export function writeConfig(extConfig: CapacitorConfig, extConfigFilePath: string): void
};
