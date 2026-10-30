// @vitest-environment jsdom
import {beforeEach, describe, expect, it, vi} from "vitest"

import {forgetInvite, readPendingInvite, rememberInvite} from "@/features/invite/pendingInvite"

const INVITE = {
    token: "t",
    email: "a@b.c",
    organization_id: "o1",
    workspace_id: "w1",
    project_id: "p1",
}

beforeEach(() => {
    const store = new Map<string, string>()
    vi.stubGlobal("localStorage", {
        getItem: (key: string) => store.get(key) ?? null,
        setItem: (key: string, value: string) => store.set(key, value),
        removeItem: (key: string) => store.delete(key),
    })
})

describe("the kept invite", () => {
    it("reads back until it is forgotten", () => {
        rememberInvite(INVITE)
        expect(readPendingInvite()).toEqual(INVITE)
        forgetInvite()
        expect(readPendingInvite()).toBeNull()
    })

    it("ignores an ordinary sign-in link that only carries an email", () => {
        rememberInvite({email: "a@b.c"})
        expect(readPendingInvite()).toBeNull()
    })

    it("does not replace a kept invite on an ordinary visit", () => {
        rememberInvite(INVITE)
        rememberInvite({email: "other@b.c"})
        expect(readPendingInvite()).toEqual(INVITE)
    })

    it("expires after 30 minutes", () => {
        rememberInvite(INVITE, 1_000)
        expect(readPendingInvite(1_000 + 30 * 60 * 1000)).toEqual(INVITE)
        expect(readPendingInvite(1_000 + 30 * 60 * 1000 + 1)).toBeNull()
    })
})
