/**
 * Copy the pdfjs-dist worker into public/ so the drive PDF thumbnail can load it as a same-origin
 * static asset (`workerSrc = "/pdf.worker.min.mjs"`).
 *
 * Why not `new URL("pdfjs-dist/build/pdf.worker.min.mjs", import.meta.url)`: the webpack production
 * build (`next build`) externalizes the ESM worker and fails ("ESM packages need to be imported").
 * Dev uses turbopack, which tolerated it — so the break only ever showed in CI. Serving it from
 * public/ keeps it local (no CDN) for self-hosted deployments and works under both bundlers.
 *
 * Runs in the `dev` and `build` scripts of both apps. OSS calls it with no argument and gets
 * its own public/; EE passes a destination ("public", relative to web/ee) because it serves
 * its own public dir. The copied file is gitignored (a node_modules artifact).
 */
import {copyFileSync, mkdirSync} from "node:fs"
import {createRequire} from "node:module"
import {dirname, join, relative, resolve} from "node:path"
import {fileURLToPath} from "node:url"

const require = createRequire(import.meta.url)
const source = require.resolve("pdfjs-dist/build/pdf.worker.min.mjs")
const publicDir = process.argv[2]
    ? resolve(process.cwd(), process.argv[2])
    : join(dirname(fileURLToPath(import.meta.url)), "..", "public")
const destination = join(publicDir, "pdf.worker.min.mjs")

mkdirSync(publicDir, {recursive: true})
copyFileSync(source, destination)
console.log(
    `[copy-pdf-worker] pdfjs worker → ${relative(process.cwd(), destination) || destination}`,
)
