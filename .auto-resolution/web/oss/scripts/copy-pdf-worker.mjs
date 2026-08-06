/**
 * Copy the pdfjs-dist worker into public/ so the drive PDF thumbnail can load it as a same-origin
 * static asset (`workerSrc = "/pdf.worker.min.mjs"`).
 *
 * Why not `new URL("pdfjs-dist/build/pdf.worker.min.mjs", import.meta.url)`: the webpack production
 * build (`next build`) externalizes the ESM worker and fails ("ESM packages need to be imported").
 * Dev uses turbopack, which tolerated it — so the break only ever showed in CI. Serving it from
 * public/ keeps it local (no CDN) for self-hosted deployments and works under both bundlers.
 *
 * Runs in the `dev` and `build` scripts. The copied file is gitignored (a node_modules artifact).
 */
import {copyFileSync, mkdirSync} from "node:fs"
import {createRequire} from "node:module"
import {dirname, join} from "node:path"
import {fileURLToPath} from "node:url"

const require = createRequire(import.meta.url)
const source = require.resolve("pdfjs-dist/build/pdf.worker.min.mjs")
const publicDir = join(dirname(fileURLToPath(import.meta.url)), "..", "public")

mkdirSync(publicDir, {recursive: true})
copyFileSync(source, join(publicDir, "pdf.worker.min.mjs"))
console.log("[copy-pdf-worker] pdfjs worker → public/pdf.worker.min.mjs")
