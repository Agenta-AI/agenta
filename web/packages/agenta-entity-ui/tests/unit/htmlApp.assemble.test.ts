/**
 * Lock on the HTML Preview assembler after its move out of `renderers.tsx` (agent HTML apps,
 * lane C). `assemblePreview` must produce byte-identical output to the pre-move
 * `inlineHtmlAssets` APART FROM THE INJECTED CSP, on three fixtures that together cover every
 * branch: plain page, page with linked CSS + images (the mount-asset inlining), and page with
 * every script vector the sandbox strips (scripts, inline handlers, `javascript:` URLs, nested
 * `srcdoc`).
 *
 * The one deliberate difference is {@link PREVIEW_CSP}. Preview used to ship no policy at all,
 * which let `<iframe src="data:text/html,…">` — a vector the stripper never covered, since it
 * only clears `srcdoc` — run a script in a nested context and `fetch` anywhere. So each fixture
 * is compared through {@link withoutCsp}, which keeps the move-lock honest about the inlining
 * while the policy itself is asserted separately below.
 *
 * Two locks per fixture: the literal string captured by RUNNING the pre-move code under this same
 * jsdom (recorded in the move commit), and a verbatim copy of that code kept below — so a jsdom
 * upgrade that changes serialisation shifts both sides, while a change to the assembler shifts one.
 */
import {beforeAll, describe, expect, it} from "vitest"

import {BRIDGE_STUB, PREVIEW_CSP, RUN_CSP} from "@agenta/entities/drive"

import {
    assemblePreview,
    assembleRunDocument,
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

/** The assembled document minus the injected policy, for comparison against the pre-move output. */
const withoutCsp = (out: string): string =>
    out.replace(`<meta http-equiv="Content-Security-Policy" content="${PREVIEW_CSP}">`, "")

describe("assemblePreview is byte-identical to the pre-move inlineHtmlAssets", () => {
    it("keeps the nav interceptor verbatim", () => {
        expect(HTML_NAV_INTERCEPTOR).toBe(LEGACY_HTML_NAV_INTERCEPTOR)
    })

    it("plain page (no mount)", async () => {
        const out = await assemblePreview(PLAIN, {dir: "", io: null})
        expect(withoutCsp(out)).toBe(EXPECTED_PLAIN)
        expect(withoutCsp(out)).toBe(await legacyInlineHtmlAssets(PLAIN, null, "", null))
    })

    it("linked css + img: same-mount assets inline, external and data: left alone", async () => {
        const out = await assemblePreview(ASSETS, {dir: "site", io})
        expect(withoutCsp(out)).toBe(EXPECTED_ASSETS)
        expect(withoutCsp(out)).toBe(await legacyInlineHtmlAssets(ASSETS, "m1", "site", "p1"))
        // Proof the inlining ran (the pre-move code fell back to the raw html on any throw).
        expect(out).toContain("<style>body{color:red}")
        expect(out).toContain("data:image/png;base64,UE5HLUJZVEVT")
    })

    it("scripts, inline handlers, javascript: urls, nested srcdoc — all stripped", async () => {
        const out = await assemblePreview(SCRIPTS, {dir: "docs", io: null})
        expect(withoutCsp(out)).toBe(EXPECTED_SCRIPTS)
        expect(withoutCsp(out)).toBe(await legacyInlineHtmlAssets(SCRIPTS, null, "docs", null))
        expect(out).not.toMatch(/alert\(1\)|onload|onclick|onmouseover|onerror|evil\(\)|srcdoc/i)
    })

    it("a document without a mount still assembles when the mount branch would be skipped", async () => {
        // Mount id present but no io == the local composer attachment path.
        const out = await assemblePreview(ASSETS, {dir: "site", io: null})
        expect(withoutCsp(out)).toBe(await legacyInlineHtmlAssets(ASSETS, null, "site", null))
        expect(out).toContain('href="./styles/app.css"')
    })
})

describe("assemblePreview carries a policy the stripper cannot substitute for", () => {
    /**
     * The hole this closes: `assemblePreview` removes `iframe[srcdoc]` but leaves
     * `iframe[src="data:text/html,…"]` alone. The nested context inherits `allow-scripts` from
     * the preview sandbox, so its script runs even though every script in the OUTER document was
     * stripped — and with no policy in the document it reached a listening server by `fetch`.
     * Asserted here as a constant so the vector cannot quietly reopen.
     */
    it("injects the CSP as the FIRST child of head, before any nested context can load", async () => {
        const out = await assemblePreview(PLAIN, {dir: "", io: null})
        expect(out).toContain(
            `<head><meta http-equiv="Content-Security-Policy" content="${PREVIEW_CSP}">`,
        )
    })

    it("denies the nested browsing contexts and the connect channel", () => {
        // `<object data="data:text/html,…">` and `<embed>` execute the same way an iframe does,
        // so naming only frame-src would move the vector rather than close it.
        expect(PREVIEW_CSP).toContain("frame-src 'none'")
        expect(PREVIEW_CSP).toContain("object-src 'none'")
        // connect-src has no directive of its own here: it falls back to default-src.
        expect(PREVIEW_CSP).toContain("default-src 'none'")
        expect(PREVIEW_CSP).not.toContain("connect-src")
    })

    it("still allows the remote stylesheet, image and font that ordinary drive HTML renders today", () => {
        // `inlineAssets` folds in same-mount assets only and leaves external URLs alone, so these
        // are live today; a policy that broke them would regress every such page.
        expect(PREVIEW_CSP).toContain("style-src 'unsafe-inline' https:")
        expect(PREVIEW_CSP).toContain("img-src data: blob: https:")
        expect(PREVIEW_CSP).toContain("font-src data: https:")
    })

    it("a data: iframe survives the stripper — which is why the policy, not the strip list, is the fix", async () => {
        const out = await assemblePreview(
            '<html><body><iframe src="data:text/html,%3Cscript%3Efetch(1)%3C/script%3E"></iframe></body></html>',
            {dir: "", io: null},
        )
        expect(out).toContain('<iframe src="data:text/html,')
    })
})

// ---------------------------------------------------------------------------------------------
// Run (agent HTML apps)
// ---------------------------------------------------------------------------------------------

const APP_FILES: Record<string, string> = {
    "app/app.js": 'console.log("app"); var s = "</script>";',
    "app/site.css": ".ag-app{padding:8px}",
    // Outside the app dir: nothing the Run assembler may touch, everything a climbing
    // reference would want.
    "secrets.json": '{"token":"SUPER-SECRET"}',
    "other-app/steal.js": "window.stolen = 1",
}
const appIo: AssembleIo = {
    fetchText: async (path) => APP_FILES[path] ?? null,
    fetchDataUri: async () => null,
}
const APP = `<html>
<head>
<meta charset="utf-8">
<link rel="stylesheet" href="site.css">
<script src="app.js"></script>
<script src="https://cdn.example.com/lib.js"></script>
<script src="missing.js"></script>
</head>
<body onload="boot()"><a href="guide.html">guide</a><script>window.inline = 1</script></body>
</html>`
const TOKENS = {"--ag-bg": "#fff", "--ag-fg": "#111", "--ag-accent": "red;}<style>"}

describe("assembleRunDocument", () => {
    it("keeps author scripts and handlers, inlines same-folder script src, drops external", async () => {
        const {html, errors} = await assembleRunDocument(APP, {
            dir: "app",
            io: appIo,
            tokens: TOKENS,
            kitCss: ".ag-btn{}",
        })
        expect(html).toContain('<body onload="boot()">')
        expect(html).toContain("<script>window.inline = 1</script>")
        // Inlined, with its own terminator neutralised.
        expect(html).toContain('console.log("app"); var s = "<\\/script>";')
        expect(html).not.toContain('src="app.js"')
        expect(html).not.toContain("cdn.example.com")
        expect(html).not.toContain("missing.js")
        expect(errors).toEqual([
            "External script dropped by the sandbox: https://cdn.example.com/lib.js",
            "Script not found in the app folder: missing.js",
        ])
        // No Preview interceptor in Run.
        expect(html).not.toContain(HTML_NAV_INTERCEPTOR)
        expect(html).toContain("<style>.ag-app{padding:8px}</style>")
    })

    // The `fs` bridge has always refused `../..`; markup used to go around it. A grant is for
    // ONE folder, so a reference that climbs out is dropped before it is fetched — otherwise an
    // app could pull any text file in the mount into a <style> and write back what it read.
    it("refuses references that climb out of the app folder", async () => {
        const climbing = `<html><head>
<link rel="stylesheet" href="../secrets.json">
<script src="../other-app/steal.js"></script>
</head><body><img src="../secrets.json"></body></html>`

        const {html, errors} = await assembleRunDocument(climbing, {
            dir: "app",
            io: appIo,
            tokens: TOKENS,
            kitCss: ".ag-btn{}",
        })

        expect(html).not.toContain("SUPER-SECRET")
        expect(html).not.toContain("window.stolen")
        expect(errors).toEqual(
            expect.arrayContaining([
                "Stylesheet outside the app folder was not loaded: ../secrets.json",
                "Script outside the app folder was not loaded: ../other-app/steal.js",
                "Image outside the app folder was not loaded: ../secrets.json",
            ]),
        )
    })

    it("still inlines references that stay inside the folder", async () => {
        const nested = `<html><head><link rel="stylesheet" href="./site.css"></head><body></body></html>`
        const {html, errors} = await assembleRunDocument(nested, {
            dir: "app",
            io: appIo,
            tokens: TOKENS,
            kitCss: ".ag-btn{}",
        })
        expect(html).toContain("<style>.ag-app{padding:8px}</style>")
        expect(errors).toEqual([])
    })

    it("injects CSP, tokens, kit and the stub at the top of head, in that order", async () => {
        const {html} = await assembleRunDocument(APP, {
            dir: "app",
            io: appIo,
            tokens: TOKENS,
            kitCss: ".ag-btn{}",
        })
        const head = html.slice(html.indexOf("<head>") + 6)
        const csp = head.indexOf(`<meta http-equiv="Content-Security-Policy" content="${RUN_CSP}">`)
        const tokens = head.indexOf(
            '<style id="agenta-tokens">:root{--ag-bg:#fff;--ag-fg:#111}</style>',
        )
        const kit = head.indexOf('<style id="agenta-kit">.ag-btn{}</style>')
        const stub = head.indexOf(`<script>${BRIDGE_STUB}</script>`)
        const charset = head.indexOf('<meta charset="utf-8">')
        expect(csp).toBe(0)
        expect(tokens).toBeGreaterThan(csp)
        expect(kit).toBeGreaterThan(tokens)
        expect(stub).toBeGreaterThan(kit)
        expect(charset).toBeGreaterThan(stub)
    })

    it("omits the kit block when kitCss is null and accepts a custom stub", async () => {
        const {html} = await assembleRunDocument(APP, {
            dir: "app",
            io: appIo,
            tokens: {},
            kitCss: null,
            bridgeStub: "window.__stub=1",
        })
        expect(html).not.toContain('id="agenta-kit"')
        expect(html).toContain('<style id="agenta-tokens">:root{}</style>')
        expect(html).toContain("<script>window.__stub=1</script>")
        expect(html).not.toContain(BRIDGE_STUB)
    })

    it("without io: every script src is dropped with a note, the document still assembles", async () => {
        const {html, errors} = await assembleRunDocument(APP, {
            dir: "app",
            io: null,
            tokens: {},
            kitCss: "",
        })
        expect(errors).toHaveLength(3)
        expect(html).toContain('id="agenta-kit"')
        expect(html).toContain('href="site.css"')
    })

    it("stamps lang and a title only when the author left them out", async () => {
        const bare = await assembleRunDocument("<html><head></head><body>x</body></html>", {
            dir: "app",
            io: null,
            tokens: {},
            kitCss: null,
            title: "Retro board",
        })
        expect(bare.html).toContain('<html lang="en">')
        expect(bare.html).toContain("<title>Retro board</title>")

        const authored = await assembleRunDocument(
            '<html lang="de"><head><title>Meins</title></head><body>x</body></html>',
            {dir: "app", io: null, tokens: {}, kitCss: null, title: "Retro board"},
        )
        expect(authored.html).toContain('<html lang="de">')
        expect(authored.html).toContain("<title>Meins</title>")
        expect(authored.html).not.toContain("Retro board")
        // The injected block still leads the head; the title lands after it.
        expect(authored.html.indexOf("<title>")).toBeGreaterThan(
            authored.html.indexOf("agenta-tokens"),
        )
    })

    it("defaults to the real bridge stub", async () => {
        const {html} = await assembleRunDocument(APP, {
            dir: "app",
            io: null,
            tokens: {},
            kitCss: null,
        })
        expect(BRIDGE_STUB.length).toBeGreaterThan(0)
        expect(html).toContain(`<script>${BRIDGE_STUB}</script>`)
    })
})
