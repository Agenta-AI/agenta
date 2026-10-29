/**
 * The bash tool's output buffer: memory stays bounded however much a command prints, and when the
 * runner skipped part of the output (Codex R5 P1-1), the totals the sandbox reports make the
 * model's notice exact.
 */
import { describe, expect, it } from "vitest";
import { CommandOutput } from "../../../src/engines/inprocess/tools/command-output.ts";

const noisy = (from: number, lines: number) => Buffer.from(Array.from({ length: lines }, (_, i) => `line ${from + i} ${"x".repeat(60)}`).join("\n") + "\n");

describe("command output", () => {
  it("holds a bounded amount in memory however much the command prints", () => {
    const output = new CommandOutput();
    let peak = 0;
    for (let i = 0; i < 400; i += 1) {
      output.append(noisy(i * 1_000, 1_000));
      peak = Math.max(peak, output.bufferedBytes);
    }
    // About 27 MB went through; memory stays near the rolling tail.
    expect(peak).toBeLessThan(512 * 1024);
    expect(output.format("/tmp/full.log").text).toContain("of 400000");
  });

  it("uses the sandbox's totals after a skipped stretch", () => {
    const output = new CommandOutput();
    output.append(noisy(0, 100));
    output.skip(10_000_000);
    const tail = noisy(200_000, 3_000);
    output.append(tail);
    output.settle({ bytes: 10_000_000 + 100 * 67 + tail.length, lines: 203_000, openLineBytes: 0 });
    const { text, truncation } = output.format("/tmp/full.log");
    expect(truncation?.totalLines).toBe(203_000);
    expect(text).toContain("of 203000");
    expect(text).toContain("line 202999");
    expect(text).not.toContain("line 99 ");
    expect(text).toContain("Full output: /tmp/full.log");
  });

  it("says how long an open last line is, from the sandbox's count", () => {
    const output = new CommandOutput();
    output.skip(5_000_000);
    output.append(Buffer.from("y".repeat(300_000)));
    output.settle({ bytes: 5_300_000, lines: 1, openLineBytes: 5_300_000 });
    expect(output.format(undefined).text).toMatch(/of line 1 \(line is 5\.1MB\)/);
  });
});
