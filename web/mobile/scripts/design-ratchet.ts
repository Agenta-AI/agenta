// Counts off-system styling in web/mobile/src and web/packages/*/src; no count may rise (DESIGN.md anti-patterns).
// Usage: tsx scripts/design-ratchet.ts [--check | --write]
import {existsSync, readFileSync, readdirSync, statSync, writeFileSync} from "fs"
import {dirname, join, relative, resolve} from "path"
import {fileURLToPath} from "url"

const HERE = dirname(fileURLToPath(import.meta.url))
const WEB = resolve(HERE, "../..")
const BASELINE = resolve(HERE, "design-ratchet.json")

const PATTERNS: Record<string, RegExp> = {
    // SURF-05: every hover fill is bg-accent (or accent layered over an opaque ground).
    "hover-fill-not-accent": /\bhover:bg-(?!accent\b|transparent\b|destructive\b|\[image:linear-gradient\(var\(--accent\))/g,
    // Old hex shims outside the legacy alias block; several never resolved in /m.
    "legacy-hex-shims": /var\(--(?:ag-c-|ag-rgba-|ant-color-)/g,
    // TYPE-05: a control's weight never changes with its state.
    "weight-by-state": /(?:data-\[state=[a-z]+\]|aria-[a-z]+(?:=[a-z]+)?|data-\[(?:active|selected)[^\]]*\]):font-(?:medium|semibold|bold)/g,
    "antd-color-names": /\bcolor(?:Text|Bg|Fill|Border|Primary|Error|Success|Warning|Info)[A-Za-z]*/g,
    "var(--ag-color": /var\(--ag-color/g,
    "text-[Npx]": /text-\[\d+(?:\.\d+)?px\]/g,
    "h-[Npx]": /h-\[\d+(?:\.\d+)?px\]/g,
    "rounded-full": /\brounded-full\b/g,
    "font-bold": /\bfont-(?:bold|extrabold|black)\b/g,
    "lucide-react": /lucide-react/g,
}

type Counts = Record<string, {mobile: number; packages: number}>

const walk = (dir: string, out: string[]) => {
    for (const name of readdirSync(dir)) {
        if (name === "node_modules" || name.startsWith(".")) continue
        const p = join(dir, name)
        if (statSync(p).isDirectory()) walk(p, out)
        else if (/\.(tsx?|mts)$/.test(name) && !name.endsWith(".d.ts")) out.push(p)
    }
}

const count = (): Counts => {
    const roots = [
        {key: "mobile" as const, dir: join(WEB, "mobile/src")},
        ...readdirSync(join(WEB, "packages"))
            .map((p) => join(WEB, "packages", p, "src"))
            .filter((d) => existsSync(d))
            .map((dir) => ({key: "packages" as const, dir})),
    ]
    const counts: Counts = Object.fromEntries(
        Object.keys(PATTERNS).map((k) => [k, {mobile: 0, packages: 0}]),
    )
    for (const {key, dir} of roots) {
        const files: string[] = []
        walk(dir, files)
        for (const file of files) {
            const src = readFileSync(file, "utf8")
            for (const [name, re] of Object.entries(PATTERNS)) {
                counts[name][key] += src.match(re)?.length ?? 0
            }
        }
    }
    return counts
}

const mode = process.argv.includes("--write") ? "write" : "check"
const now = count()

if (mode === "write") {
    writeFileSync(BASELINE, `${JSON.stringify(now, null, 4)}\n`)
    console.log(`design-ratchet: baseline written to ${relative(WEB, BASELINE)}`)
    console.table(now)
    process.exit(0)
}

const base: Counts = existsSync(BASELINE) ? JSON.parse(readFileSync(BASELINE, "utf8")) : {}
const over: string[] = []
const under: string[] = []
for (const [name, c] of Object.entries(now)) {
    for (const area of ["mobile", "packages"] as const) {
        const b = base[name]?.[area] ?? 0
        if (c[area] > b) over.push(`${name} in ${area}: ${c[area]} > baseline ${b}`)
        else if (c[area] < b) under.push(`${name} in ${area}: ${c[area]} < baseline ${b}`)
    }
}
if (over.length) {
    console.error(`design-ratchet: counts rose above the baseline (DESIGN.md anti-patterns):\n  ${over.join("\n  ")}`)
    process.exit(1)
}
if (under.length) {
    console.log(`design-ratchet: counts fell; run \`pnpm run design:ratchet --write\` to lock them in:\n  ${under.join("\n  ")}`)
}
console.log("design-ratchet: ok")
