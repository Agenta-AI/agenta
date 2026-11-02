import {NextRequest} from "next/server"
import {afterEach, describe, expect, it} from "vitest"

import {middleware} from "./middleware"

const PHONE_UA =
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1"

const KEYS = ["AGENTA_MOBILE_GATE", "AGENTA_MOBILE_REVERSE_GATE", "AGENTA_MOBILE_ENABLED"] as const
const saved = Object.fromEntries(KEYS.map((key) => [key, process.env[key]]))

afterEach(() => {
    for (const key of KEYS) {
        if (saved[key] === undefined) delete process.env[key]
        else process.env[key] = saved[key]
    }
})

const phoneVisit = (path: string) =>
    middleware(
        new NextRequest(`http://localhost:3000${path}`, {
            headers: {"user-agent": PHONE_UA, "sec-fetch-dest": "document"},
        }),
    ).headers.get("location")

describe("desktop gate middleware", () => {
    it("sends a phone to /m with no env key set", () => {
        expect(phoneVisit("/w")).toBe("http://localhost:3000/m/")
    })

    it("ignores a stale AGENTA_MOBILE_GATE=false", () => {
        process.env.AGENTA_MOBILE_GATE = "false"
        process.env.AGENTA_MOBILE_REVERSE_GATE = "true"
        expect(phoneVisit("/w")).toBe("http://localhost:3000/m/")
    })

    it("ignores AGENTA_MOBILE_ENABLED=false: /m always ships", () => {
        process.env.AGENTA_MOBILE_ENABLED = "false"
        expect(phoneVisit("/w")).toBe("http://localhost:3000/m/")
    })
})
