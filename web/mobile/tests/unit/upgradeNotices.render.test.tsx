// @vitest-environment jsdom
import {act, type ReactNode} from "react"

import type {Release, SidebarConfig, UpdateSize, UpgradeMethod} from "@agenta/navigation"
import {createStore, Provider, type PrimitiveAtom} from "jotai"
import {createRoot, type Root} from "react-dom/client"
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest"

interface ReleaseAtoms {
    releases: PrimitiveAtom<Release[]>
    notInstalled: PrimitiveAtom<Release[]>
    running: PrimitiveAtom<string | null>
    size: PrimitiveAtom<UpdateSize | null>
    method: PrimitiveAtom<UpgradeMethod | null>
    security: PrimitiveAtom<Release | null>
}

const {atoms, permission, edition, copied} = vi.hoisted(() => ({
    atoms: {current: null as ReleaseAtoms | null},
    permission: {allowed: true, pending: false},
    edition: {ee: false},
    copied: [] as string[],
}))

// The release atoms read the API; each test sets what the API would have answered. The package
// tests cover how the API answer (and cloud) turns into these values.
vi.mock("@agenta/navigation", async (importOriginal) => {
    const original = await importOriginal<Record<string, unknown>>()
    const {atom} = await import("jotai")
    atoms.current = {
        releases: atom<Release[]>([]),
        notInstalled: atom<Release[]>([]),
        running: atom<string | null>(null),
        size: atom<UpdateSize | null>(null),
        method: atom<UpgradeMethod | null>(null),
        security: atom<Release | null>(null),
    }
    return {
        ...original,
        releaseListAtom: atoms.current.releases,
        notInstalledReleasesAtom: atoms.current.notInstalled,
        runningVersionAtom: atoms.current.running,
        updateSizeAtom: atoms.current.size,
        upgradeMethodAtom: atoms.current.method,
        securityReleaseAtom: atoms.current.security,
        isSecurityWarningSnoozed: () => false,
    }
})

vi.mock("@agenta/shared/api", async (importOriginal) => ({
    ...(await importOriginal<Record<string, unknown>>()),
    isEE: () => edition.ee,
}))

vi.mock("@agenta/shared/state", async (importOriginal) => {
    const original = await importOriginal<Record<string, unknown>>()
    const {atom} = await import("jotai")
    return {...original, projectIdAtom: atom("proj-1")}
})

vi.mock("@agenta/ui/utils", async (importOriginal) => ({
    ...(await importOriginal<Record<string, unknown>>()),
    copyToClipboard: async (text: string) => {
        copied.push(text)
        return true
    },
}))

vi.mock("@/features/context/useProjectPermission", () => ({
    useProjectPermission: () => permission.allowed && !permission.pending,
    useProjectPermissionState: () => ({...permission, failed: false, recheck: () => undefined}),
}))

vi.mock("@/features/education/useReleaseNotices", () => ({
    useReleaseNotices: () => ({notices: [], dismiss: () => undefined}),
}))

vi.mock("@/features/maintenance/useMaintenanceNotice", () => ({
    useMaintenanceNotice: () => null,
}))

vi.mock("next/router", () => ({
    useRouter: () => ({asPath: "/w/ws-1/p/proj-1/agents", pathname: "/w/[ws]/p/[p]/agents"}),
}))

import {UpgradeBox} from "@/features/education/UpgradeBox"
import {whatsNewAtom} from "@/features/education/whatsNewAtom"
import {WhatsNewDialog} from "@/features/education/WhatsNewDialog"
import {MaintenanceNoticeBar} from "@/features/maintenance/MaintenanceNoticeBar"
import {useMobileHelpItem} from "@/features/nav/useMobileNavItems"
;(globalThis as typeof globalThis & {IS_REACT_ACT_ENVIRONMENT: boolean}).IS_REACT_ACT_ENVIRONMENT =
    true
// jsdom has no ResizeObserver; the bar measures itself with one.
globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
} as unknown as typeof ResizeObserver

const release = (id: string, extra: Partial<Release> = {}): Release => ({
    id,
    date: "2026-11-24",
    features: [{id: `entry-${id}`, title: `Title ${id}`, body: "", link: "https://agenta.ai/docs"}],
    improvements: [],
    fixes: [],
    ...extra,
})

describe("upgrade notices", () => {
    let root: Root
    let host: HTMLDivElement
    let store: ReturnType<typeof createStore>

    const behind = ({
        notInstalled,
        running = "v0.129.0",
        size,
        method = null,
    }: {
        notInstalled: Release[]
        running?: string
        size: UpdateSize
        method?: UpgradeMethod | null
    }) => {
        const a = atoms.current!
        store.set(a.releases, [...notInstalled, release(running)])
        store.set(a.notInstalled, notInstalled)
        store.set(a.running, running)
        store.set(a.size, size)
        store.set(a.method, method)
        store.set(a.security, notInstalled.find((r) => r.securityFix) ?? null)
    }

    const render = (node: ReactNode) =>
        act(() => root.render(<Provider store={store}>{node}</Provider>))

    const text = () => host.textContent ?? ""
    const button = (label: string) =>
        [...host.querySelectorAll("button")].find((b) => b.textContent?.includes(label))

    beforeEach(() => {
        host = document.createElement("div")
        document.body.appendChild(host)
        root = createRoot(host)
        store = createStore()
        permission.allowed = true
        permission.pending = false
        edition.ee = false
        copied.length = 0
    })

    afterEach(() => {
        act(() => root.unmount())
        host.remove()
    })

    describe("help menu", () => {
        let help: SidebarConfig | null = null
        const Probe = () => {
            help = useMobileHelpItem()
            return null
        }
        const row = (key: string) => help?.submenu?.find((item) => item.key === key)
        const renderNode = (node: ReactNode) => {
            const box = document.createElement("div")
            const nodeRoot = createRoot(box)
            act(() => nodeRoot.render(<>{node}</>))
            const html = box.innerHTML
            act(() => nodeRoot.unmount())
            return html
        }

        it.each([
            ["minor", "New minor version: v0.131.0", "bg-colorWarning", "text-colorWarning"],
            [
                "patch",
                "New patch version: v0.131.0",
                "bg-colorTextTertiary",
                "text-colorTextTertiary",
            ],
            ["security", "Security update: v0.131.0", "bg-colorError", "text-colorError"],
        ] as const)("names a %s update and colors the dot and arrow", (size, label, bg, fg) => {
            behind({notInstalled: [release("v0.131.0"), release("v0.130.0")], size})
            render(<Probe />)

            const update = row("update-available")
            expect(update?.title).toBe(label)
            expect(renderNode(update?.suffix)).toContain("2 releases behind")
            expect(renderNode(update?.icon)).toContain(fg)
            expect(renderNode(help?.icon)).toContain(bg)
        })

        it("says 1 release behind for one missing release", () => {
            behind({notInstalled: [release("v0.129.1")], running: "v0.129.0", size: "patch"})
            render(<Probe />)
            expect(renderNode(row("update-available")?.suffix)).toContain("1 release behind")
        })

        it("opens the What's new dialog on the newest release, not the docs", () => {
            behind({notInstalled: [release("v0.131.0"), release("v0.130.0")], size: "minor"})
            render(<Probe />)

            const update = row("update-available")
            expect(update?.link).toBeUndefined()
            act(() => update?.onClick?.())
            expect(store.get(whatsNewAtom)).toEqual({releaseId: "v0.131.0"})
        })

        it("tags a missing release with a security fix", () => {
            behind({
                notInstalled: [release("v0.131.0"), release("v0.130.1", {securityFix: true})],
                size: "security",
            })
            render(<Probe />)

            const tagged = renderNode(row("v0.130.1")?.suffix)
            expect(tagged).toContain("Security fix")
            expect(tagged).toContain("bg-colorErrorBg")
            expect(tagged).toContain("Not installed")
            expect(renderNode(row("v0.131.0")?.suffix)).not.toContain("Security fix")
        })

        it("shows no update row and no dot when up to date (and on cloud)", () => {
            store.set(atoms.current!.releases, [release("v0.131.0")])
            render(<Probe />)

            expect(row("update-available")).toBeUndefined()
            expect(renderNode(help?.icon)).not.toContain("rounded-full")
        })
    })

    describe("upgrade box", () => {
        it("says how far behind the instance is", () => {
            behind({notInstalled: [release("v0.131.0"), release("v0.130.0")], size: "minor"})
            render(<UpgradeBox />)

            expect(text()).toContain("2 releases behind")
            expect(text()).toContain("You run v0.129.0. The latest release is v0.131.0.")
            expect(text()).toContain("2 releases are not installed.")
            expect(text()).not.toContain("security issue")
            const guide = host.querySelector<HTMLAnchorElement>("a[href$='/self-host/upgrading']")
            expect(guide?.textContent).toBe("How to upgrade")
            expect(host.querySelector("[data-update-size]")?.className).toContain("bg-colorWarning")
        })

        it("says when a missing release fixes a security issue", () => {
            behind({
                notInstalled: [release("v0.131.0"), release("v0.130.1", {securityFix: true})],
                size: "security",
            })
            render(<UpgradeBox />)
            expect(text()).toContain("One of them fixes a security issue.")
        })

        it("uses the plural when several missing releases fix a security issue", () => {
            behind({
                notInstalled: [
                    release("v0.131.0", {securityFix: true}),
                    release("v0.130.1", {securityFix: true}),
                    release("v0.130.0"),
                ],
                size: "security",
            })
            render(<UpgradeBox />)
            expect(text()).toContain("3 releases are not installed.")
            expect(text()).toContain("2 of them fix a security issue.")
        })

        it("shows nothing when up to date, which is also what cloud gets", () => {
            store.set(atoms.current!.releases, [release("v0.131.0")])
            store.set(atoms.current!.running, "v0.131.0")
            render(<UpgradeBox />)
            expect(host.innerHTML).toBe("")
        })

        it.each([
            ["compose", ["git pull", "up -d --pull always", "docker-compose.gh.yml"]],
            ["helm", ["git pull", "helm upgrade agenta hosting/kubernetes/helm", "kubectl"]],
            [
                "railway",
                [
                    'AGENTA_API_IMAGE="ghcr.io/agenta-ai/agenta-api:v0.131.0"',
                    'AGENTA_WEB_MOBILE_IMAGE="ghcr.io/agenta-ai/agenta-web-mobile:v0.131.0"',
                    "deploy-from-images.sh",
                ],
            ],
        ] as const)("shows the %s commands to an admin", (method, lines) => {
            behind({notInstalled: [release("v0.131.0")], size: "minor", method})
            render(<UpgradeBox />)

            const code = host.querySelector("pre")?.textContent ?? ""
            expect(code.startsWith("# In the folder where you cloned Agenta")).toBe(true)
            for (const line of lines) expect(code).toContain(line)
            expect(text()).toContain("Commands for your setup")
            expect(text()).toContain("If you pinned image tags, change them to v0.131.0 first.")
        })

        it("shows no commands for an unknown method, only the guide", () => {
            behind({notInstalled: [release("v0.131.0")], size: "minor", method: null})
            render(<UpgradeBox />)
            expect(host.querySelector("pre")).toBeNull()
            expect(button("Copy commands")).toBeUndefined()
            expect(text()).toContain("How to upgrade")
        })

        it("shows no commands on Enterprise", () => {
            edition.ee = true
            behind({notInstalled: [release("v0.131.0")], size: "minor", method: "compose"})
            render(<UpgradeBox />)
            expect(host.querySelector("pre")).toBeNull()
        })

        it("tells a member to ask the person who runs the server", () => {
            permission.allowed = false
            behind({notInstalled: [release("v0.131.0")], size: "minor", method: "compose"})
            render(<UpgradeBox />)

            expect(text()).toContain("Ask the person who runs your Agenta server to upgrade.")
            expect(host.querySelector("pre")).toBeNull()
            expect(text()).toContain("How to upgrade")
        })

        it("shows neither line while the permission check runs", () => {
            permission.allowed = false
            permission.pending = true
            behind({notInstalled: [release("v0.131.0")], size: "minor", method: "compose"})
            render(<UpgradeBox />)

            expect(text()).not.toContain("Ask the person")
            expect(host.querySelector("pre")).toBeNull()
        })

        it("copies the commands and the agent prompt", async () => {
            behind({notInstalled: [release("v0.131.0")], size: "minor", method: "compose"})
            render(<UpgradeBox />)

            await act(async () => button("Copy commands")?.click())
            expect(copied[0]).toBe(host.querySelector("pre")?.textContent)
            expect(button("Copied")).toBeDefined()

            await act(async () => button("Copy a prompt for your coding agent")?.click())
            expect(copied[1]).toContain(
                "Upgrade my self-hosted Agenta from v0.129.0 to v0.131.0. It runs with Docker Compose (open source edition).",
            )
            expect(copied[1]).toContain("https://agenta.ai/docs/self-host/upgrading")
            expect(copied[1]).toContain("check that the help menu shows v0.131.0.")
        })

        it("warns about a missing release with extra upgrade steps", () => {
            const link = "https://agenta.ai/docs/self-host/upgrading#upgrading-to-01270"
            behind({
                notInstalled: [release("v0.128.0"), release("v0.127.0", {upgradeNotesLink: link})],
                running: "v0.126.0",
                size: "minor",
                method: "compose",
            })
            render(<UpgradeBox />)

            expect(text()).toContain("v0.127.0 has extra upgrade steps.")
            const read = host.querySelector<HTMLAnchorElement>(`a[href="${link}"]`)
            expect(read?.textContent).toBe("Read them before you run these commands.")
        })
    })

    describe("What's new dialog", () => {
        it("tags a missing security release in the rail and starts with the upgrade box", () => {
            behind({
                notInstalled: [release("v0.131.0"), release("v0.130.1", {securityFix: true})],
                size: "security",
                method: "compose",
            })
            store.set(whatsNewAtom, {releaseId: "v0.131.0"})
            render(<WhatsNewDialog />)

            const rail = [...document.body.querySelectorAll("button")].map((b) => b.textContent)
            expect(rail.find((label) => label?.startsWith("v0.130.1"))).toContain(
                "Security fixNot installed",
            )
            expect(rail.find((label) => label?.startsWith("v0.131.0"))).not.toContain(
                "Security fix",
            )
            expect(document.body.querySelector("[data-testid='upgrade-box']")).not.toBeNull()
        })
    })

    describe("security bar", () => {
        it("opens the What's new dialog on the security release", () => {
            behind({
                notInstalled: [release("v0.131.0"), release("v0.130.1", {securityFix: true})],
                size: "security",
            })
            render(<MaintenanceNoticeBar />)

            expect(text()).toContain("Upgrade to v0.130.1 or later.")
            expect(host.querySelector("a")).toBeNull()
            act(() => button("How to upgrade")?.click())
            expect(store.get(whatsNewAtom)).toEqual({releaseId: "v0.130.1"})
        })

        it("does not show for a member", () => {
            permission.allowed = false
            behind({
                notInstalled: [release("v0.130.1", {securityFix: true})],
                size: "security",
            })
            render(<MaintenanceNoticeBar />)
            expect(host.innerHTML).toBe("")
        })
    })
})
