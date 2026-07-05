import {ArrowRight} from "@phosphor-icons/react"
import {Typography} from "antd"
import {useAtomValue} from "jotai"
import {useRouter} from "next/router"

import {urlAtom} from "@/oss/state/url"

import {AGENT_TEMPLATES, templateBuilderMessage} from "../assets/templates"

import {useOnboardingContext} from "./OnboardingContext"

/**
 * The onboarding left panel — the "OPTIONAL · START FROM A TEMPLATE" list, rendered in the config
 * panel slot (via MainLayout's `renderConfigOverride`) while the agent is still ephemeral. Picking a
 * template commits THIS mount's ephemeral in place (no redirect) and seeds the builder with the
 * template's instruction. Once the agent is real, MainLayout renders the normal config forms instead.
 */
const OnboardingConfigPanel = () => {
    const {commit, committing} = useOnboardingContext()
    const router = useRouter()
    const {baseAppURL} = useAtomValue(urlAtom)

    return (
        // Fade the templates out while committing so they're gone before MainLayout swaps in the real
        // config panel — softens the left-panel handoff instead of a hard cut.
        <div
            className={`flex h-full flex-col gap-2 p-4 motion-safe:transition-opacity motion-safe:duration-300 ${
                committing ? "opacity-0" : "opacity-100"
            }`}
        >
            <Typography.Text className="!px-1 !text-[11px] !font-semibold !uppercase !tracking-wide !text-[var(--ag-colorTextTertiary)]">
                Optional · Start from a template
            </Typography.Text>

            <div className="flex flex-col gap-0.5">
                {AGENT_TEMPLATES.map((template) => (
                    <button
                        key={template.key}
                        type="button"
                        disabled={committing}
                        onClick={() => commit(templateBuilderMessage(template), template.name)}
                        className="box-border flex w-full cursor-pointer items-start gap-2.5 rounded-lg border-0 bg-transparent px-2 py-2 text-left transition-colors hover:bg-[var(--ag-colorFillTertiary)] disabled:cursor-not-allowed disabled:opacity-60"
                    >
                        <span className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-md bg-[var(--ag-colorFillSecondary)] text-[11px] font-semibold text-[var(--ag-colorTextSecondary)]">
                            {template.initials}
                        </span>
                        <span className="flex min-w-0 flex-col">
                            <span className="truncate text-xs font-medium text-[var(--ag-colorTextSecondary)]">
                                {template.name}
                            </span>
                            <span className="truncate text-[11px] text-[var(--ag-colorTextTertiary)]">
                                {template.description}
                            </span>
                        </span>
                    </button>
                ))}
            </div>

            <button
                type="button"
                onClick={() => baseAppURL && router.push(`${baseAppURL}/agent-templates`)}
                className="mt-1 inline-flex w-fit cursor-pointer items-center gap-1 border-0 bg-transparent px-2 py-1 text-xs text-[var(--ag-colorPrimary)] hover:underline"
            >
                Browse all templates
                <ArrowRight size={13} />
            </button>
        </div>
    )
}

export default OnboardingConfigPanel
