/**
 * The Run assembler for agent HTML apps: `assembleRunDocument` keeps author scripts, inlines what
 * the app folder holds (and refuses references that climb out of it), and injects the CSP, tokens,
 * kit and bridge stub at the top of head.
 */
import {BRIDGE_STUB, RUN_CSP} from "@agenta/entities/drive"
import {describe, expect, it} from "vitest"

import {assembleRunDocument, type AssembleIo} from "../../src/drive/htmlApp/assemble"

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
    it("keeps author scripts and handlers, inlines same-folder script src, keeps https", async () => {
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
        // Remote https scripts are left for the browser; RUN_CSP allows them.
        expect(html).toContain('src="https://cdn.example.com/lib.js"')
        expect(html).not.toContain("missing.js")
        expect(errors).toEqual(["Script not found in the app folder: missing.js"])
        expect(html).toContain("<style>.ag-app{padding:8px}</style>")
    })

    it("drops a remote script that is not https, with a note", async () => {
        const {html, errors} = await assembleRunDocument(
            '<html><head><script src="http://cdn.example.com/old.js"></script></head><body></body></html>',
            {dir: "app", io: appIo, tokens: {}, kitCss: null},
        )
        expect(html).not.toContain("old.js")
        expect(errors).toEqual([
            "Script not loaded, only https:// scripts can run: http://cdn.example.com/old.js",
        ])
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

    it("without io: every local script src is dropped with a note, the document still assembles", async () => {
        const {html, errors} = await assembleRunDocument(APP, {
            dir: "app",
            io: null,
            tokens: {},
            kitCss: "",
        })
        expect(errors).toHaveLength(2)
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
