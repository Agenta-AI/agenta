import {useMemo} from "react"

import {useThemeMode} from "@agenta/ui/theme"

import {useRouter} from "next/router"

import {AntiPatternsWall} from "./guide/AntiPatternsWall"
import {CodeSnippet} from "./guide/CodeSnippet"
import {GuideNav} from "./guide/GuideNav"
import {GuideOverview} from "./guide/GuideOverview"
import {GuidePagePicker} from "./guide/GuidePagePicker"
import {guidePages} from "./guide/guidePages"
import {designRules} from "./guide/ruleIndex"
import {PropsTable} from "./guide/PropsTable"
import {RuleBlock} from "./guide/RuleBlock"
import {ThemeToggle} from "./ThemeToggle"

// Rules show in rules.json order on every page.
const ruleOrder = new Map(designRules.map((r, i) => [r.id, i]))
const byRuleOrder = (a: {id: string}, b: {id: string}) =>
    (ruleOrder.get(a.id) ?? 0) - (ruleOrder.get(b.id) ?? 0)

export function DesignSystemScreen() {
    const router = useRouter()
    const {resolved: mode, setMode} = useThemeMode()
    const pages = useMemo(
        () => guidePages(mode).map((p) => ({...p, rules: [...p.rules].sort(byRuleOrder)})),
        [mode],
    )
    const current =
        router.isReady && typeof router.query.page === "string" ? router.query.page : "overview"
    const page = pages.find((p) => p.id === current) ?? pages[0]

    const open = (id: string, anchor?: string) =>
        void router.push({pathname: router.pathname, query: {page: id}, hash: anchor}, undefined, {
            shallow: true,
        })

    return (
        <div className="ag-ds min-h-dvh bg-background text-foreground">
            <div className="mx-auto grid max-w-[1200px] gap-8 px-4 py-6 sm:px-6 lg:grid-cols-[232px_minmax(0,1fr)]">
                <aside className="lg:sticky lg:top-6 lg:self-start">
                    <div className="mb-4 flex items-center justify-between gap-2 px-2">
                        <span className="whitespace-nowrap text-label">Agenta design</span>
                        <ThemeToggle mode={mode} onChange={setMode} />
                    </div>
                    <div className="lg:hidden">
                        <GuidePagePicker
                            pages={pages}
                            current={page.id}
                            onSelect={(id) => open(id)}
                        />
                    </div>
                    <div className="hidden lg:block">
                        <GuideNav
                            pages={pages}
                            current={router.isReady ? page.id : ""}
                            onSelect={(id) => open(id)}
                        />
                    </div>
                </aside>
                <main className="min-w-0" hidden={!router.isReady}>
                    <header className="mb-8">
                        <div className="text-meta text-muted-foreground">{page.group}</div>
                        <h1 className="m-0 text-heading">{page.title}</h1>
                        <p className="m-0 mt-1 max-w-[68ch] text-body text-muted-foreground">
                            {page.tagline}
                        </p>
                    </header>
                    {page.id === "overview" ? <GuideOverview pages={pages} /> : null}
                    {page.id === "anti-patterns" ? (
                        <AntiPatternsWall pages={pages} onOpen={open} />
                    ) : null}
                    {page.code || page.api ? (
                        <div className="mb-10 flex max-w-[68ch] flex-col gap-4">
                            {page.code ? <CodeSnippet code={page.code} /> : null}
                            {page.api ? <PropsTable rows={page.api} /> : null}
                        </div>
                    ) : null}
                    {page.specimen ? (
                        <div className="mb-10 flex flex-col gap-10">{page.specimen}</div>
                    ) : null}
                    {page.rules.length ? (
                        <div className="flex flex-col gap-8">
                            {page.rules.map((r) => (
                                <RuleBlock key={r.id} rule={r} />
                            ))}
                        </div>
                    ) : null}
                </main>
            </div>
        </div>
    )
}
