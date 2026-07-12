/** Narrow structural ports shared by helpers that operate on a remote sandbox. */
export interface SandboxDirectoryPort {
  readonly sandboxId?: string;
  mkdirFs(input: { path: string }): Promise<unknown>;
}

export interface SandboxFilePort extends SandboxDirectoryPort {
  writeFsFile(input: { path: string }, body: string): Promise<unknown>;
}

export interface SandboxProcessPort extends SandboxDirectoryPort {
  runProcess(input: {
    command: string;
    args?: string[];
    cwd?: string;
    env?: Record<string, string>;
    timeoutMs?: number;
  }): Promise<unknown>;
}

export type SandboxAssetPort = SandboxFilePort & SandboxProcessPort;
export type SandboxWorkspacePort = Partial<
  SandboxFilePort & SandboxProcessPort
>;
