import {describe, expect, it} from "vitest"

import {
    reduceTabRunBadge,
    tabRunBadge,
    type SessionStatuses,
    type TabRunBadge,
    type TabRunBadgeEvent,
    type TabRunBadgeState,
} from "@/features/app/tabRunBadge"

const hide: TabRunBadgeEvent = {type: "visibility", hidden: true}
const show: TabRunBadgeEvent = {type: "visibility", hidden: false}
const status = (statuses: SessionStatuses): TabRunBadgeEvent => ({type: "status", statuses})

/** The badge after each event, starting from a visible tab with no runs. */
const badgesAfter = (events: TabRunBadgeEvent[]): TabRunBadge[] => {
    let state: TabRunBadgeState = {hidden: false, statuses: {}, settled: null}
    return events.map((event) => {
        state = reduceTabRunBadge(state, event)
        return tabRunBadge(state)
    })
}

describe("tab run badge", () => {
    it("never badges a visible tab through a whole run", () => {
        expect(
            badgesAfter([
                status({a: "running"}),
                status({a: "awaiting"}),
                status({a: "running"}),
                status({}),
            ]),
        ).toEqual([null, null, null, null])
    })

    it("keeps a run that finished while hidden as completed until the user returns", () => {
        expect(badgesAfter([status({a: "running"}), hide, status({}), show])).toEqual([
            null,
            "running",
            "completed",
            null,
        ])
    })

    it("shows waiting while the run is parked on the user, live", () => {
        expect(
            badgesAfter([
                hide,
                status({a: "running"}),
                status({a: "awaiting"}),
                status({a: "running"}),
                show,
            ]),
        ).toEqual([null, "running", "awaiting", "running", null])
    })

    it("clears on return mid-run and badges again on the next leave", () => {
        expect(badgesAfter([status({a: "running"}), hide, show, hide])).toEqual([
            null,
            "running",
            null,
            "running",
        ])
    })

    it("holds a run that failed while hidden as error, through the cleanup to idle", () => {
        expect(
            badgesAfter([hide, status({a: "running"}), status({a: "error"}), status({})]),
        ).toEqual([null, "running", "error", "error"])
    })

    it("does not badge an error the user already saw before leaving", () => {
        expect(badgesAfter([status({a: "running"}), status({a: "error"}), hide])).toEqual([
            null,
            null,
            null,
        ])
    })

    it("completes a background run cleanly beside an old error in another session", () => {
        expect(
            badgesAfter([
                status({old: "error", bg: "running"}),
                hide,
                status({old: "error"}),
                show,
            ]),
        ).toEqual([null, "running", "completed", null])
    })

    it("keeps an error from one run when a later run in the same absence finishes cleanly", () => {
        expect(
            badgesAfter([
                hide,
                status({a: "running"}),
                status({a: "error"}),
                status({a: "error", b: "running"}),
                status({a: "error"}),
            ]),
        ).toEqual([null, "running", "error", "running", "error"])
    })

    it("does not call a run completed when the user saw it finish", () => {
        expect(badgesAfter([hide, status({a: "running"}), show, status({}), hide])).toEqual([
            null,
            "running",
            null,
            null,
            null,
        ])
    })
})
