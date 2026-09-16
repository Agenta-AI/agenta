/**
 * The container half of the MCP gateway switch.
 *
 * `entrypoint.sh` normalizes `AGENTA_MCP_GATEWAY_ENABLED` before writing it into `__env.js`,
 * so whatever it decides is what the browser's `isMcpGatewayEnabled` ever sees. A flag the
 * shell flattens to "true" cannot be read as off later, however careful the TypeScript is —
 * which is why both halves are checked against the same vocabulary.
 *
 * The block is taken out of the real script rather than copied here: a copy would keep
 * passing after someone changed the script.
 */
import {execFileSync} from "node:child_process"
import {readFileSync} from "node:fs"
import {dirname, resolve} from "node:path"
import {fileURLToPath} from "node:url"

import {describe, expect, it} from "vitest"

const ENTRYPOINT = resolve(dirname(fileURLToPath(import.meta.url)), "../../../../entrypoint.sh")

const MARKER = 'case "$(printf \'%s\' "${AGENTA_MCP_GATEWAY_ENABLED}"'

/** The normalization block as the script actually spells it today. */
const normalizationBlock = (): string => {
    const script = readFileSync(ENTRYPOINT, "utf8")
    const start = script.indexOf(MARKER)
    expect(start, `${ENTRYPOINT} no longer normalizes AGENTA_MCP_GATEWAY_ENABLED`).toBeGreaterThan(
        -1,
    )
    const end = script.indexOf("\nesac", start)
    expect(end).toBeGreaterThan(start)
    return script.slice(start, end + "\nesac".length)
}

/** What the script exports for a given input, or for no input at all. */
const normalized = (value?: string): string =>
    execFileSync(
        "sh",
        ["-c", `${normalizationBlock()}\nprintf '%s' "$AGENTA_MCP_GATEWAY_ENABLED"`],
        {
            env:
                value === undefined
                    ? {PATH: process.env.PATH}
                    : {PATH: process.env.PATH, AGENTA_MCP_GATEWAY_ENABLED: value},
            encoding: "utf8",
        },
    )

describe("entrypoint.sh normalizes the MCP gateway switch", () => {
    it("keeps the plane on for a deployment that says nothing", () => {
        expect(normalized()).toBe("true")
        expect(normalized("")).toBe("true")
        expect(normalized("  ")).toBe("true")
    })

    it("keeps it on for every spelling the API reads as on", () => {
        for (const on of ["true", "TRUE", "1", "t", "y", "yes", "on", "enable", "enabled"]) {
            expect(normalized(on), on).toBe("true")
        }
    })

    it("turns it off for every spelling the API reads as off", () => {
        // Before this, only the literal "false" reached the browser as off: an operator who
        // wrote `0` got an API that refused every MCP route and an interface that still
        // offered the whole feature.
        for (const off of ["false", "FALSE", "0", "off", "no", "n", "disabled", "nonsense"]) {
            expect(normalized(off), off).toBe("false")
        }
    })
})
