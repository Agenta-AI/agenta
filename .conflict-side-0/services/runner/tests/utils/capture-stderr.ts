/**
 * Capture what the runner writes to stderr, so a test can assert on the greppable `[keepalive]`
 * log lines. The runner logs through `process.stderr.write` directly (no logger seam), so the
 * only way to observe a line is to swap the write. Always `restore()` in a `finally`.
 */
export function captureStderr(): {
  lines: string[];
  restore: () => void;
} {
  const lines: string[] = [];
  const original = process.stderr.write.bind(process.stderr);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (process.stderr as any).write = (chunk: any) => {
    lines.push(String(chunk));
    return true;
  };
  return {
    lines,
    restore: () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (process.stderr as any).write = original;
    },
  };
}
