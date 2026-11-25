// Parses one docs changelog entry (docs/blog/entries/*.mdx) into a release entry.
// build-releases.mjs runs it over every entry; the unit tests import it directly.

const DOCS_ORIGIN = "https://agenta.ai/docs"
const VERSION_TAG = /^v\d+\.\d+\.\d+$/
const SECURITY_TAG = "security"
/** The covers the What's new dialog can draw. A demo video wins over a cover. */
export const RELEASE_COVERS = ["builder", "models", "channels"]

const unquote = (raw) => {
    const value = raw.trim()
    if (value.startsWith('"')) return JSON.parse(value)
    if (value.startsWith("'")) return value.slice(1, -1).replace(/''/g, "'")
    return value
}

const parseInlineList = (raw) =>
    raw
        .trim()
        .replace(/^\[|\]$/g, "")
        .split(",")
        .map((item) => unquote(item))
        .filter(Boolean)

// Parses only the frontmatter subset the changelog uses, and throws on anything else.
export const parseFrontmatter = (source, file) => {
    const match = /^---\n([\s\S]*?)\n---\n/.exec(source)
    if (!match) throw new Error(`${file}: no frontmatter`)
    const data = {}
    let listKey = null
    for (const line of match[1].split("\n")) {
        if (!line.trim()) continue
        const top = /^([A-Za-z_][\w-]*):\s*(.*)$/.exec(line)
        if (top) {
            const [, key, rest] = top
            listKey = null
            if (rest === "") {
                data[key] = []
                listKey = key
            } else if (rest.startsWith("[")) data[key] = parseInlineList(rest)
            else data[key] = unquote(rest)
            continue
        }
        const item = /^\s+-\s+([\w-]+):\s*(.+)$/.exec(line)
        const field = /^\s+([\w-]+):\s*(.+)$/.exec(line)
        if (listKey && item) data[listKey].push({[item[1]]: unquote(item[2])})
        else if (listKey && field && data[listKey].length > 0)
            data[listKey].at(-1)[field[1]] = unquote(field[2])
        else throw new Error(`${file}: unsupported frontmatter line: ${line}`)
    }
    return data
}

const parseItems = (value, key, file) => {
    if (value === undefined) return []
    if (!Array.isArray(value)) throw new Error(`${file}: ${key} must be a list`)
    return value.map((entry) => {
        if (typeof entry?.area !== "string" || typeof entry?.text !== "string")
            throw new Error(`${file}: every ${key} item needs an area and a text`)
        return {area: entry.area, text: checkHttpsOnly(entry.text, `${file}: ${key}`)}
    })
}

// Instances show only https links and images; fail here so the feed never carries another one.
const HTTP_LINK = /\bhttp:/i
const checkHttpsOnly = (markdown, where) => {
    if (HTTP_LINK.test(markdown)) throw new Error(`${where}: links and images must use https`)
    return markdown
}

const absolutizeLinks = (markdown) => markdown.replace(/\]\(\/(?!\/)/g, `](${DOCS_ORIGIN}/`)

// Skips MDX tag and comment lines until they close, then escapes any stray "<".
const stripMdx = (markdown) => {
    const kept = []
    let inMdx = false
    for (const line of markdown.split("\n")) {
        const text = line.trim()
        if (!inMdx && (text.startsWith("<") || text.startsWith("{/*"))) inMdx = true
        if (!inMdx) kept.push(line)
        else if (text.endsWith(">") || text.endsWith("*/}")) inMdx = false
    }
    return kept
        .join("\n")
        .replace(/\n{3,}/g, "\n\n")
        .trim()
        .replace(/</g, "&lt;")
}

const parseCover = (value, file) => {
    if (value === undefined) return undefined
    if (!RELEASE_COVERS.includes(value))
        throw new Error(`${file}: cover must be one of ${RELEASE_COVERS.join(", ")}`)
    return value
}

/** Returns null for an entry without a version tag. */
export const parseEntry = (source, name) => {
    const data = parseFrontmatter(source, name)
    const tags = Array.isArray(data.tags) ? data.tags : []
    const version = tags.find((tag) => VERSION_TAG.test(tag))
    if (!version) return null
    for (const key of ["title", "slug", "date"])
        if (typeof data[key] !== "string" || !data[key]) throw new Error(`${name}: missing ${key}`)
    if (!/^\d{4}-\d{2}-\d{2}$/.test(data.date)) throw new Error(`${name}: date must be YYYY-MM-DD`)
    const summary = /<Summary>([\s\S]*?)<\/Summary>/.exec(source)
    if (!summary) throw new Error(`${name}: a versioned entry needs a <Summary>`)
    const stream =
        /<Stream\b[^>]*?\bsrc="([^"]+)"/.exec(source) ??
        /cloudflarestream\.com\/([0-9a-f]{32})\//.exec(source)
    const cover = parseCover(data.cover, name)
    return {
        version,
        securityFix: tags.includes(SECURITY_TAG),
        date: data.date,
        feature: {
            id: data.slug,
            title: data.title,
            body: checkHttpsOnly(absolutizeLinks(stripMdx(summary[1])), `${name}: <Summary>`),
            link: `${DOCS_ORIGIN}/changelog/${data.slug}`,
            ...(stream ? {streamVideoId: stream[1]} : cover ? {cover} : {}),
        },
        improvements: parseItems(data.improvements, "improvements", name),
        fixes: parseItems(data.fixes, "fixes", name),
    }
}
