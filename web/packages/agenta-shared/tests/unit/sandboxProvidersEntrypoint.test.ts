/**
 * The container half of the sandbox picker's deployment gate.
 *
 * `entrypoint.sh` turns `AGENTA_RUNNER_ENABLED_SANDBOX_PROVIDERS` into the list the browser's
 * `getEnabledSandboxProviders` reads. `inprocess` is enabled wherever `daytona` is, with no
 * setting of its own (the runner, the SDK and the API apply the same rule), so the picker must
 * see it on a deployment that lists only `daytona`. Who is offered it is the per-user
 * preference's decision, not this list's.
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

const START = 'AGENTA_ENABLED_SANDBOX_PROVIDERS="$(printf'
const END = "export AGENTA_ENABLED_SANDBOX_PROVIDERS\n"

const block = (): string => {
    const script = readFileSync(ENTRYPOINT, "utf8")
    const start = script.indexOf(START)
    expect(
        start,
        `${ENTRYPOINT} no longer derives AGENTA_ENABLED_SANDBOX_PROVIDERS`,
    ).toBeGreaterThan(-1)
    const end = script.indexOf(END, start)
    expect(end).toBeGreaterThan(start)
    return script.slice(start, end + END.length)
}

/** What the script exports for a given runner list, or for no list at all. */
const exported = (value?: string): string =>
    execFileSync("sh", ["-c", `${block()}\nprintf '%s' "$AGENTA_ENABLED_SANDBOX_PROVIDERS"`], {
        env:
            value === undefined
                ? {PATH: process.env.PATH}
                : {PATH: process.env.PATH, AGENTA_RUNNER_ENABLED_SANDBOX_PROVIDERS: value},
        encoding: "utf8",
    })

describe("entrypoint.sh exports the effective sandbox providers", () => {
    it("adds inprocess wherever daytona is enabled", () => {
        expect(exported("daytona")).toBe("daytona,inprocess")
        expect(exported(" Local , DAYTONA ")).toBe("local,daytona,inprocess")
    })

    it("keeps daytona first, so a new agent still defaults to it", () => {
        expect(exported("daytona").split(",")[0]).toBe("daytona")
    })

    it("does not add inprocess without daytona", () => {
        expect(exported()).toBe("local")
        expect(exported("local")).toBe("local")
    })

    it("keeps an explicit inprocess as written", () => {
        expect(exported("daytona,inprocess")).toBe("daytona,inprocess")
        expect(exported("inprocess,daytona")).toBe("inprocess,daytona")
    })
})

describe("getEnabledSandboxProviders applies the same rule in the browser", () => {
    const runtimeList = (value?: string) => {
        if (value === undefined) delete (globalThis as Record<string, any>).__env
        else
            (globalThis as Record<string, any>).__env = {
                NEXT_PUBLIC_AGENTA_ENABLED_SANDBOX_PROVIDERS: value,
            }
    }

    it("adds inprocess after daytona for a list the entrypoint did not write (next dev)", async () => {
        const {getEnabledSandboxProviders} = await import("../../src/api/env")
        runtimeList("daytona")
        expect(getEnabledSandboxProviders()).toEqual(["daytona", "inprocess"])
        runtimeList("daytona,inprocess")
        expect(getEnabledSandboxProviders()).toEqual(["daytona", "inprocess"])
        runtimeList("local")
        expect(getEnabledSandboxProviders()).toEqual(["local"])
        runtimeList(undefined)
    })
})
