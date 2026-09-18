/**
 * Lock on the HTML Preview assembler after its move out of `renderers.tsx` (agent HTML apps,
 * lane C). `assemblePreview` must produce BYTE-IDENTICAL output to the pre-move
 * `inlineHtmlAssets`, on three fixtures that together cover every branch: plain page, page with
 * linked CSS + images (the mount-asset inlining), and page with every script vector the sandbox
 * strips (scripts, inline handlers, `javascript:` URLs, nested `srcdoc`).
 *
 * Two locks per fixture: the literal string captured by RUNNING the pre-move code under this same
 * jsdom (recorded in the move commit), and a verbatim copy of that code kept below — so a jsdom
 * upgrade that changes serialisation shifts both sides, while a change to the assembler shifts one.
 */
import {beforeAll, describe, expect, it} from "vitest"

import {
    assemblePreview,
    blobToDataUri,
    HTML_NAV_INTERCEPTOR,
    type AssembleIo,
} from "../../src/drive/htmlApp/assemble"

// ---------------------------------------------------------------------------------------------
// Environment: jsdom's Blob has no `.text()`; browsers do. Same polyfill for both sides.
// ---------------------------------------------------------------------------------------------

beforeAll(() => {
    if (typeof Blob.prototype.text !== "function") {
        Blob.prototype.text = function text(this: Blob) {
            return new Promise<string>((resolve, reject) => {
                const reader = new FileReader()
                reader.onload = () => resolve(String(reader.result))
                reader.onerror = () => reject(reader.error)
                reader.readAsText(this)
            })
        }
    }
})

/** The mount, as `fetchMountFileBlob` would serve it (mount-relative path → blob). */
const FILES: Record<string, {text: string; type: string}> = {
    "site/styles/app.css": {text: "body{color:red}\n.card{padding:4px}", type: "text/css"},
    "site/img/logo.png": {text: "PNG-BYTES", type: "image/png"},
}

const fetchMountFileBlob = async ({path}: {path: string}): Promise<Blob | null> => {
    const f = FILES[path]
    return f ? new Blob([f.text], {type: f.type}) : null
}

const io: AssembleIo = {
    fetchText: async (path) => {
        const blob = await fetchMountFileBlob({path})
        return blob ? blob.text() : null
    },
    fetchDataUri: async (path) => blobToDataUri(await fetchMountFileBlob({path})),
}

// ---------------------------------------------------------------------------------------------
// Verbatim pre-move code: renderers.tsx @ 00df09d2d2 (only the mount fetchers are bound to the
// map above instead of the network).
// ---------------------------------------------------------------------------------------------

const isExternalUrl = (u: string): boolean =>
    /^[a-z][a-z0-9+.-]*:/i.test(u) || u.startsWith("//") || u.startsWith("#")
const resolveRel = (dir: string, rel: string): string => {
    const out: string[] = []
    for (const seg of (dir ? dir.split("/") : []).concat(rel.split("/"))) {
        if (seg === "" || seg === ".") continue
        if (seg === "..") out.pop()
        else out.push(seg)
    }
    return out.join("/")
}
const INLINE_ASSET_CAP = 8 * 1024 * 1024
async function fetchMountText(
    mountId: string,
    projectId: string,
    path: string,
): Promise<string | null> {
    const blob = await fetchMountFileBlob({mountId, projectId, path} as {path: string})
    return blob ? blob.text() : null
}
async function fetchMountDataUri(
    mountId: string,
    projectId: string,
    path: string,
): Promise<string | null> {
    const blob = await fetchMountFileBlob({mountId, projectId, path} as {path: string})
    if (!blob || blob.size > INLINE_ASSET_CAP) return null
    return new Promise((resolve) => {
        const reader = new FileReader()
        reader.onload = () => resolve(typeof reader.result === "string" ? reader.result : null)
        reader.onerror = () => resolve(null)
        reader.readAsDataURL(blob)
    })
}
const LEGACY_HTML_NAV_INTERCEPTOR =
    '(function(){document.addEventListener("click",function(e){var el=e.target;while(el&&el.tagName!=="A")el=el.parentElement;if(!el)return;var href=el.getAttribute("href");if(!href||href.charAt(0)==="#")return;if(/^[a-z][a-z0-9+.-]*:/i.test(href)||href.indexOf("//")===0)return;e.preventDefault();parent.postMessage({type:"ag-html-nav",href:href},"*")},true)})()'
async function legacyInlineHtmlAssets(
    html: string,
    mountId: string | null,
    dir: string,
    projectId: string | null,
): Promise<string> {
    try {
        const doc = new DOMParser().parseFromString(html, "text/html")
        if (mountId && projectId) {
            await Promise.all(
                Array.from(
                    doc.querySelectorAll<HTMLLinkElement>('link[rel~="stylesheet"][href]'),
                ).map(async (link) => {
                    const href = link.getAttribute("href") ?? ""
                    if (!href || isExternalUrl(href)) return
                    const css = await fetchMountText(mountId, projectId, resolveRel(dir, href))
                    if (css == null) return
                    const style = doc.createElement("style")
                    style.textContent = css
                    link.replaceWith(style)
                }),
            )
            await Promise.all(
                Array.from(doc.querySelectorAll<HTMLImageElement>("img[src]")).map(async (img) => {
                    const src = img.getAttribute("src") ?? ""
                    if (!src || isExternalUrl(src) || src.startsWith("data:")) return
                    const uri = await fetchMountDataUri(mountId, projectId, resolveRel(dir, src))
                    if (uri) img.setAttribute("src", uri)
                }),
            )
        }
        doc.querySelectorAll("script").forEach((s) => s.remove())
        doc.querySelectorAll("iframe[srcdoc]").forEach((f) => f.removeAttribute("srcdoc"))
        doc.querySelectorAll("*").forEach((el) => {
            for (const attr of Array.from(el.attributes)) {
                if (/^on/i.test(attr.name)) el.removeAttribute(attr.name)
                else if (/^\s*javascript:/i.test(attr.value)) el.setAttribute(attr.name, "#")
            }
        })
        doc.querySelectorAll("a[href]").forEach((a) => {
            if (isExternalUrl(a.getAttribute("href") ?? "")) {
                a.setAttribute("target", "_blank")
                a.setAttribute("rel", "noopener noreferrer")
            }
        })
        const interceptor = doc.createElement("script")
        interceptor.textContent = LEGACY_HTML_NAV_INTERCEPTOR
        ;(doc.body ?? doc.documentElement).appendChild(interceptor)
        return `<!DOCTYPE html>\n${doc.documentElement.outerHTML}`
    } catch {
        return html
    }
}

// ---------------------------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------------------------

const PLAIN = `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><title>Plain</title></head>
<body>
<h1>Hello</h1>
<p>Just text &amp; an <em>emphasis</em>.</p>
</body>
</html>`

const ASSETS = `<html>
<head>
<link rel="stylesheet" href="./styles/app.css">
<link rel="stylesheet" href="https://cdn.example.com/x.css">
<link rel="stylesheet" href="missing.css">
</head>
<body>
<img src="img/logo.png" alt="logo">
<img src="https://example.com/a.png" alt="ext">
<img src="data:image/png;base64,AAAA" alt="data">
<a href="../other/page.html">up</a>
</body>
</html>`

const SCRIPTS = `<html>
<head>
<script src="app.js"></script>
<script>alert(1)</script>
</head>
<body onload="boot()">
<a href="javascript:evil()">js</a>
<a href="https://example.com">ext</a>
<a href="guide.html">guide</a>
<a href="#top">top</a>
<div onclick="hi()" ONMOUSEOVER="x()">c</div>
<iframe srcdoc="&lt;script&gt;x&lt;/script&gt;"></iframe>
<img src="x.png" onerror="p()">
<form action="  JavaScript:go()"><button>go</button></form>
</body>
</html>`

// Captured by running the pre-move `inlineHtmlAssets` under this jsdom, in the move commit.
const INTERCEPTOR_TAG = `<script>${LEGACY_HTML_NAV_INTERCEPTOR}</script>`

const EXPECTED_PLAIN =
    '<!DOCTYPE html>\n<html><head><meta charset="utf-8"><title>Plain</title></head>\n<body>\n<h1>Hello</h1>\n<p>Just text &amp; an <em>emphasis</em>.</p>\n\n' +
    INTERCEPTOR_TAG +
    "</body></html>"

const EXPECTED_ASSETS =
    '<!DOCTYPE html>\n<html><head>\n<style>body{color:red}\n.card{padding:4px}</style>\n<link rel="stylesheet" href="https://cdn.example.com/x.css">\n<link rel="stylesheet" href="missing.css">\n</head>\n<body>\n<img src="data:image/png;base64,UE5HLUJZVEVT" alt="logo">\n<img src="https://example.com/a.png" alt="ext">\n<img src="data:image/png;base64,AAAA" alt="data">\n<a href="../other/page.html">up</a>\n\n' +
    INTERCEPTOR_TAG +
    "</body></html>"

const EXPECTED_SCRIPTS =
    '<!DOCTYPE html>\n<html><head>\n\n\n</head>\n<body>\n<a href="#" target="_blank" rel="noopener noreferrer">js</a>\n<a href="https://example.com" target="_blank" rel="noopener noreferrer">ext</a>\n<a href="guide.html">guide</a>\n<a href="#top" target="_blank" rel="noopener noreferrer">top</a>\n<div>c</div>\n<iframe></iframe>\n<img src="x.png">\n<form action="#"><button>go</button></form>\n\n' +
    INTERCEPTOR_TAG +
    "</body></html>"

// ---------------------------------------------------------------------------------------------

describe("assemblePreview is byte-identical to the pre-move inlineHtmlAssets", () => {
    it("keeps the nav interceptor verbatim", () => {
        expect(HTML_NAV_INTERCEPTOR).toBe(LEGACY_HTML_NAV_INTERCEPTOR)
    })

    it("plain page (no mount)", async () => {
        const out = await assemblePreview(PLAIN, {dir: "", io: null})
        expect(out).toBe(EXPECTED_PLAIN)
        expect(out).toBe(await legacyInlineHtmlAssets(PLAIN, null, "", null))
    })

    it("linked css + img: same-mount assets inline, external and data: left alone", async () => {
        const out = await assemblePreview(ASSETS, {dir: "site", io})
        expect(out).toBe(EXPECTED_ASSETS)
        expect(out).toBe(await legacyInlineHtmlAssets(ASSETS, "m1", "site", "p1"))
        // Proof the inlining ran (the pre-move code fell back to the raw html on any throw).
        expect(out).toContain("<style>body{color:red}")
        expect(out).toContain("data:image/png;base64,UE5HLUJZVEVT")
    })

    it("scripts, inline handlers, javascript: urls, nested srcdoc — all stripped", async () => {
        const out = await assemblePreview(SCRIPTS, {dir: "docs", io: null})
        expect(out).toBe(EXPECTED_SCRIPTS)
        expect(out).toBe(await legacyInlineHtmlAssets(SCRIPTS, null, "docs", null))
        expect(out).not.toMatch(/alert\(1\)|onload|onclick|onmouseover|onerror|evil\(\)|srcdoc/i)
    })

    it("a document without a mount still assembles when the mount branch would be skipped", async () => {
        // Mount id present but no io == the local composer attachment path.
        const out = await assemblePreview(ASSETS, {dir: "site", io: null})
        expect(out).toBe(await legacyInlineHtmlAssets(ASSETS, null, "site", null))
        expect(out).toContain('href="./styles/app.css"')
    })
})
