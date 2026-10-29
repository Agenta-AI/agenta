import {readFileSync} from "node:fs"
import {join} from "node:path"

import {describe, expect, it} from "vitest"

const FORBIDDEN = ["antd", "@ant-design/x", "@ant-design/icons", "react-virtuoso", "lexical"]

describe("@agenta/chat package contract", () => {
    const pkg = JSON.parse(readFileSync(join(__dirname, "../../package.json"), "utf8"))

    it("is named @agenta/chat with a src entry", () => {
        expect(pkg.name).toBe("@agenta/chat")
        expect(pkg.main).toBe("./src/index.ts")
    })

    it("never depends on desktop UI toolkits", () => {
        const all = {...pkg.dependencies, ...pkg.peerDependencies, ...pkg.devDependencies}
        for (const dep of FORBIDDEN) expect(all[dep], dep).toBeUndefined()
    })
})
