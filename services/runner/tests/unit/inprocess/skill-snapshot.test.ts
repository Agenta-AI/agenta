/** The skill snapshot goes to the drive whole, several files at a time, with its marker last. */
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { publishSkillSnapshot } from "../../../src/engines/inprocess/workspace/skill-snapshot.ts";
import { PI_SKILL_SNAPSHOT_MARKER } from "../../../src/engines/sandbox_agent/pi-assets.ts";
import { memoryObjects, TEST_CREDENTIALS } from "../../utils/local-drive.ts";

describe("publishing the skill snapshot", () => {
  it("puts every file, the marker last, and nothing again once the marker is there", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "skills-"));
    const snapshot = join(cwd, "agents", "skills", "d1");
    for (let i = 0; i < 20; i += 1) {
      mkdirSync(join(snapshot, `s${i}`), { recursive: true });
      writeFileSync(join(snapshot, `s${i}`, "SKILL.md"), `skill ${i}`);
    }
    writeFileSync(join(snapshot, PI_SKILL_SNAPSHOT_MARKER), "{}");
    const objects = memoryObjects()(() => TEST_CREDENTIALS);
    const order: string[] = [];
    const put = objects.put.bind(objects);
    objects.put = async (rel, body) => {
      order.push(rel);
      await put(rel, body);
    };
    await publishSkillSnapshot(cwd, snapshot, objects, () => {});
    expect(order).toHaveLength(21);
    expect(order.at(-1)).toBe(`agents/skills/d1/${PI_SKILL_SNAPSHOT_MARKER}`);
    await publishSkillSnapshot(cwd, snapshot, objects, () => {});
    expect(order).toHaveLength(21);
  });
});
