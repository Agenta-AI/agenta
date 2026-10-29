import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { describe, it } from "vitest";

import {
  piAiBundlePaths,
  piCliBundlePaths,
} from "../../scripts/pi-ai-bundles.ts";
import patchSpec from "../../src/tools/pi-provider-cost-patch.json" with { type: "json" };
import {
  applyPiProviderCostPatch,
  PI_AI_ANCHOR,
  PI_CLI_ANCHOR,
  type PiProviderCostAnchor,
} from "../../src/tools/pi-provider-cost-patch.ts";
import packageJson from "../../package.json" with { type: "json" };

const BUMPING_PI = "See services/runner/AGENTS.md, 'Bumping Pi'.";

function staleSpec(installed: string): string {
  return (
    `The OpenRouter cost patch (src/tools/pi-provider-cost-patch.json) was written for Pi ` +
    `${patchSpec.piVersion}. Pi is now ${installed}. Check the patch anchors against the new Pi, ` +
    `then update piVersion. ${BUMPING_PI}`
  );
}

describe("the Pi OpenRouter cost patch spec", () => {
  it("was written for the pinned Pi", () => {
    const deps: Record<string, string> = packageJson.dependencies;
    const piCodingAgent = deps["@earendil-works/pi-coding-agent"];
    assert.equal(patchSpec.piVersion, piCodingAgent, staleSpec(piCodingAgent));

    const piAi = deps["pi-coding-agent-pi-ai"]?.replace(
      "npm:@earendil-works/pi-ai@",
      "",
    );
    assert.equal(patchSpec.piVersion, piAi, staleSpec(`pi-ai ${piAi}`));
  });

  const installed = existsSync("node_modules/@earendil-works/pi-coding-agent");

  const bindsName = installed
    ? "binds exactly once in every installed copy of Pi"
    : "binds exactly once in every installed copy of Pi (skipped: node_modules is absent)";
  it.skipIf(!installed)(bindsName, () => {
    const targets: Array<[string[], PiProviderCostAnchor]> = [
      [piAiBundlePaths(patchSpec.bundlePath), PI_AI_ANCHOR],
      [piCliBundlePaths(patchSpec.cli.bundlePath), PI_CLI_ANCHOR],
    ];
    for (const [bundles, anchor] of targets) {
      assert.ok(
        bundles.length > 0,
        `No installed Pi file for ${anchor.functionStart}. ${BUMPING_PI}`,
      );
      for (const bundle of bundles) {
        const source = readFileSync(bundle, "utf8");
        const expected = source.includes(patchSpec.marker)
          ? anchor.replacement
          : anchor.anchor;
        assert.equal(
          source.split(expected).length - 1,
          1,
          `${bundle}: the patch anchor does not match exactly once. ${BUMPING_PI}`,
        );
        if (!source.includes(patchSpec.marker)) {
          assert.equal(
            applyPiProviderCostPatch(source, anchor).kind,
            "patched",
            bundle,
          );
        }
      }
    }
  });
});
