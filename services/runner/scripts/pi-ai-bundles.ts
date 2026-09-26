/**
 * Find every installed copy of one file inside `@earendil-works/pi-ai`, for the build-time Pi
 * patches (`patch-pi-validation-message.ts`, `patch-pi-provider-cost.ts`).
 *
 * `require.resolve` is not usable here: neither Pi package declares an `exports` entry for its
 * `package.json`, and `pi-ai` is not hoisted to the top level, so both lookups throw. What is
 * stable is the layout. `node_modules/@earendil-works/pi-coding-agent` is a symlink into the pnpm
 * store, and the `pi-ai` its own resolution uses is its sibling inside that same store entry, so
 * one `realpath` finds the copy Node would actually load.
 *
 * The store is also swept for any other copy, because a build-time patch should leave no
 * unpatched duplicate behind for a different peer set to resolve to.
 */
import { existsSync, readdirSync, realpathSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

const PI_AI = join("@earendil-works", "pi-ai");

export function piAiBundlePaths(bundlePath: string): string[] {
  const found = new Set<string>();
  const add = (dir: string): void => {
    const bundle = join(dir, bundlePath);
    if (existsSync(bundle)) found.add(realpathSync(bundle));
  };

  try {
    const real = realpathSync(join("node_modules", "@earendil-works", "pi-coding-agent"));
    add(join(dirname(dirname(real)), PI_AI));
  } catch {
    // Not installed at the top level; the store sweep below still covers it.
  }
  add(join("node_modules", PI_AI));

  try {
    const store = join("node_modules", ".pnpm");
    for (const entry of readdirSync(store)) {
      add(join(store, entry, "node_modules", PI_AI));
    }
  } catch {
    // No pnpm store (a different installer, or a pruned image); the paths above are the answer.
  }
  return [...found];
}

/**
 * Write a patched bundle as a NEW file, then rename it over the old one.
 *
 * pnpm hardlinks every file in `node_modules/.pnpm` to its global content-addressable store. A
 * plain `writeFileSync` truncates and rewrites that shared inode, so it would patch the store
 * itself and every other checkout on the machine that links the same file. The rename gives this
 * install its own copy and leaves the store untouched. In an image build it makes no difference.
 */
export function writeBundle(bundle: string, source: string): void {
  const staging = `${bundle}.agenta-patch.tmp`;
  writeFileSync(staging, source);
  renameSync(staging, bundle);
}
