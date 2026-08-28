import {describe, expect, it} from "vitest"

import {isAgentIconPath, isAgentIconRecord} from "../../src/workflow/state/agentIcon"

const valid = {icon: "robot", color: "#113955", path: "<rect width='256' height='256'/>"}

describe("isAgentIconRecord", () => {
    it("accepts a well-formed record", () => {
        expect(isAgentIconRecord(valid)).toBe(true)
    })

    it("ignores extra keys, so a record written by a later version still reads", () => {
        expect(isAgentIconRecord({...valid, tint: "#E5F1F9"})).toBe(true)
    })

    it("rejects null and non-objects", () => {
        for (const value of [null, undefined, "robot", 7, true, []]) {
            expect(isAgentIconRecord(value)).toBe(false)
        }
    })

    it("rejects a record missing any field", () => {
        expect(isAgentIconRecord({color: valid.color, path: valid.path})).toBe(false)
        expect(isAgentIconRecord({icon: valid.icon, path: valid.path})).toBe(false)
        expect(isAgentIconRecord({icon: valid.icon, color: valid.color})).toBe(false)
    })

    it("rejects a field of the wrong type", () => {
        expect(isAgentIconRecord({...valid, icon: 1})).toBe(false)
        expect(isAgentIconRecord({...valid, color: null})).toBe(false)
        expect(isAgentIconRecord({...valid, path: {}})).toBe(false)
    })

    /**
     * `path` reaches `dangerouslySetInnerHTML`, and localStorage is outside the trust boundary. The
     * `<` check is the one thing standing between a hand-edited entry and the DOM, so it gets its own
     * tests rather than riding on the shape checks above.
     */
    it("rejects a path that is not markup", () => {
        expect(isAgentIconRecord({...valid, path: ""})).toBe(false)
        expect(isAgentIconRecord({...valid, path: "javascript:alert(1)"})).toBe(false)
        expect(isAgentIconRecord({...valid, path: "onload=alert(1)"})).toBe(false)
    })

    it("rejects markup that is not a plain SVG shape", () => {
        for (const path of [
            "<script>alert(1)</script>",
            '<path d="M0,0" onload="alert(1)"><script>x</script>',
            "<img src=x onerror=alert(1)>",
            "<foreignObject><body>x</body></foreignObject>",
            '<a href="javascript:alert(1)"><path d="M0,0"/></a>',
        ]) {
            expect(isAgentIconPath(path)).toBe(false)
            expect(isAgentIconRecord({...valid, path})).toBe(false)
        }
    })

    it("accepts the shapes the generator emits", () => {
        for (const path of [
            '<path d="M0,0Z"/>',
            '<circle cx="128" cy="128" r="96"/>',
            '<rect width="256" height="256"/>',
            '<path d="M0,0Z"/><circle cx="1" cy="1" r="1"/>',
        ]) {
            expect(isAgentIconPath(path)).toBe(true)
        }
    })

    it("rejects markup that does not start at the first character", () => {
        expect(isAgentIconRecord({...valid, path: " <rect/>"})).toBe(false)
        expect(isAgentIconRecord({...valid, path: "x<rect/>"})).toBe(false)
    })
})
