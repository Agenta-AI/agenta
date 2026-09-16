/**
 * Copy the pdfjs-dist worker into an app's public/ so the drive PDF thumbnail can load it as a
 * same-origin static asset (`workerSrc = "/pdf.worker.min.mjs"`).
 *
 * Why not `new URL("pdfjs-dist/build/pdf.worker.min.mjs", import.meta.url)`: the webpack production
 * build (`next build`) externalizes the ESM worker and fails ("ESM packages need to be imported").
 * Dev uses turbopack, which tolerated it — so the break only ever showed in CI. Serving it from
 * public/ keeps it local (no CDN) for self-hosted deployments and works under both bundlers.
 *
 * Lives here because this package owns the pdfjs dependency, so the worker resolves wherever the
 * package is installed. Each app's `dev` and `build` run it with its public dir (relative to the
 * app); the copied file is gitignored (a node_modules artifact).
 */
import {copyFileSync, mkdirSync} from "node:fs"
import {createRequire} from "node:module"
import {join, relative, resolve} from "node:path"

const require = createRequire(import.meta.url)
const source = require.resolve("pdfjs-dist/build/pdf.worker.min.mjs")
const publicDir = resolve(process.cwd(), process.argv[2] ?? "public")
const destination = join(publicDir, "pdf.worker.min.mjs")

mkdirSync(publicDir, {recursive: true})
copyFileSync(source, destination)
console.log(
    `[copy-pdf-worker] pdfjs worker → ${relative(process.cwd(), destination) || destination}`,
)
