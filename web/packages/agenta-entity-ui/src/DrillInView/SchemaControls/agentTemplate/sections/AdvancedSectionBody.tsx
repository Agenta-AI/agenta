/**
 * The Advanced section's body: Agenta tools, the build kit, the execution environment and the
 * custom secrets, as a rail of panels (or a narrowed stack under a focus filter).
 * `useModelHarness` passes the config state in; the group open, revert and rail state live here.
 */
import {useState, type ReactNode} from "react"

import type {AgentSecretBinding} from "@agenta/entities/secret"
import type {SchemaProperty} from "@agenta/entities/shared"
import {ConfigAccordionSection} from "@agenta/ui/components/presentational"
import {Cube, Hammer, Toolbox, Vault} from "@phosphor-icons/react"

import {useHasChangedUnder, useRevertUnder} from "../../../../drawers/shared/ChangedPathsContext"
import {useFocusPaths, useHasFocusUnder} from "../../../../drawers/shared/FocusPathsContext"
import {FieldLayoutProvider, RailField} from "../../../../drawers/shared/RailField"
import {SectionRail, type SectionRailItem} from "../../../../drawers/shared/SectionRail"
import {ScrollFadeArea} from "../../../../shared/ScrollFadeArea"
import {EnumSelectControl, type getEnumOptions} from "../../EnumSelectControl"
import {RevertGroupButton} from "../RevertGroupButton"

import type {ModelHarnessT} from "./types"

/** One Advanced rail panel: its nav item, an optional header, and the controls it shows. */
interface AdvancedPanel {
    item: SectionRailItem
    header?: {title: string; caption: string; extra?: ReactNode}
    body: ReactNode
}

export interface AdvancedSectionBodyParams {
    t: ModelHarnessT
    disabled?: boolean
    withTooltip?: boolean
    hasExecutionGroup: boolean
    sandboxProps: Record<string, SchemaProperty>
    sandboxOptions: ReturnType<typeof getEnumOptions>
    shownSandboxKind: string | null
    setSection: (key: string, sectionValue: unknown) => void
    sandbox: Record<string, unknown>
    agentaToolsSection: ReactNode
    buildKitSection: ReactNode
    hasBuildKitOverlay: boolean
    secretBindings: AgentSecretBinding[]
    secretsSummary: string
    secretsBody: ReactNode
    setSecretsHeaderSlot: (element: HTMLElement | null) => void
}

export const useAdvancedSectionBody = ({
    t,
    disabled,
    withTooltip,
    hasExecutionGroup,
    sandboxProps,
    sandboxOptions,
    shownSandboxKind,
    setSection,
    sandbox,
    agentaToolsSection,
    buildKitSection,
    hasBuildKitOverlay,
    secretBindings,
    secretsSummary,
    secretsBody,
    setSecretsHeaderSlot,
}: AdvancedSectionBodyParams) => {
    // Which Advanced sub-sections own an uncommitted change (see `ChangedPathsProvider`). Drives
    // `defaultOpen` so a drawer opened from a "something changed" indicator lands with the changed
    // group ALREADY expanded instead of three closed rows. Mount-time is the right moment:
    // `SectionDrawer` uses `destroyOnClose`, so this re-evaluates on every open.
    const sandboxChanged = useHasChangedUnder("sandbox.kind")
    const changedIndicator = (changed: boolean) =>
        changed
            ? ({tone: "draft", tooltip: t("entityUi.modelHarness.unsavedGroupChanges")} as const)
            : undefined

    // Section-scoped undo: restore every changed property in this group to its committed value. The
    // per-row dot reverts ONE property; this is "undo the whole group". Null when nothing changed or
    // the surface offers no revert, so the header keeps its normal actions.
    const revertSandbox = useRevertUnder("sandbox.kind")

    // Confirmed — see `RevertGroupButton`, which owns the confirm step.
    const revertAction = (onRevert: (() => void) | null) =>
        onRevert ? <RevertGroupButton onConfirm={onRevert} disabled={disabled} /> : undefined

    // FOCUS (see FocusPathsContext): when a surface narrows to the properties that matter — e.g. the
    // config panel showing only what changed — a group renders only if it owns one of them, and the
    // rows filter themselves. Chrome follows the content: with changes in ONE group there is nothing
    // to disambiguate, so it renders FLAT (just the controls, like the Connect-key field); spread
    // across several, the group headers earn their keep by saying which change belongs where.
    const focus = useFocusPaths()
    const sandboxInFocus = useHasFocusUnder("sandbox.kind")
    const flatFocus = focus.active

    // Advanced header summary: sandbox only — the connection mode now comes with the picked model.
    const advancedSummary =
        hasExecutionGroup && sandbox.kind
            ? t("entityUi.modelHarness.sandboxSummary", {kind: String(sandbox.kind)})
            : undefined
    // Shared Advanced controls, rendered by both the wide drawer body and the tabs-inline body.
    // Each group is a `ConfigAccordionSection` (the shared drawer section shell used by the trigger
    // and tools drawers); inside, configuration reads as the drawer's `[rail | content]` rhythm via
    // `RailField` (labelled control rows).
    /**
     * One Advanced group. Under a focus filter it disappears unless it owns a focused property, and
     * drops its chrome entirely when it's the only survivor — the body (the real controls) is the
     * same either way, so nothing is rendered twice.
     */
    const advancedGroup = (
        opts: {
            inFocus: boolean
            defaultOpen: boolean
            indicator: ReturnType<typeof changedIndicator>
            extra: ReactNode
            icon: ReactNode
            title: string
            summary?: string
            caption: ReactNode
        },
        body: ReactNode,
    ) => {
        if (!opts.inFocus) return null
        // Flat: just the focused control(s) — the group header would only restate the section.
        if (flatFocus) return <div className="flex flex-col gap-3">{body}</div>
        return (
            <ConfigAccordionSection
                size="compact"
                defaultOpen={opts.defaultOpen}
                indicator={opts.indicator}
                extra={opts.extra}
                icon={opts.icon}
                title={opts.title}
                summary={opts.summary}
                summaryCollapsedOnly
            >
                {opts.caption}
                {body}
            </ConfigAccordionSection>
        )
    }

    const executionBody = (
        <>
            {hasExecutionGroup ? (
                <RailField
                    label={t("entityUi.modelHarness.sandbox")}
                    align="center"
                    path="sandbox.kind"
                >
                    <EnumSelectControl
                        schema={sandboxProps.kind}
                        options={sandboxOptions}
                        value={shownSandboxKind}
                        onChange={(v) => setSection("sandbox", {...sandbox, kind: v})}
                        withTooltip={withTooltip}
                        disabled={disabled}
                    />
                </RailField>
            ) : null}
        </>
    )

    const advancedControls = (
        <>
            {focus.active ? null : agentaToolsSection}
            {/* Playground-only overlay — it owns no committed property, so a focus filter drops it. */}
            {focus.active ? null : buildKitSection}

            {hasExecutionGroup
                ? advancedGroup(
                      {
                          inFocus: sandboxInFocus,
                          defaultOpen: sandboxChanged,
                          indicator: changedIndicator(sandboxChanged),
                          extra: revertAction(revertSandbox),
                          icon: <Cube size={15} />,
                          title: t("entityUi.modelHarness.executionEnvironment"),
                          summary: sandbox.kind
                              ? t("entityUi.modelHarness.sandboxSummary", {
                                    kind: String(sandbox.kind),
                                })
                              : undefined,
                          caption: (
                              <span className="text-xs leading-snug text-colorTextDescription">
                                  {t("entityUi.modelHarness.executionCaptionShort")}
                              </span>
                          ),
                      },
                      executionBody,
                  )
                : null}

            {focus.active ? null : (
                <ConfigAccordionSection
                    size="compact"
                    defaultOpen={secretBindings.length > 0}
                    icon={<Vault size={15} />}
                    title={t("entityUi.modelHarness.customSecrets")}
                    summary={secretsSummary}
                    summaryCollapsedOnly
                >
                    {secretsBody}
                </ConfigAccordionSection>
            )}
        </>
    )

    // One rail panel per Advanced group, schema-gated: no group, no rail item and no panel.
    const advancedPanels: AdvancedPanel[] = (
        [
            hasExecutionGroup && {
                item: {
                    value: "execution",
                    label: t("entityUi.modelHarness.execution"),
                    icon: <Cube size={14} />,
                    status: sandboxChanged ? ("warning" as const) : undefined,
                },
                header: {
                    title: t("entityUi.modelHarness.executionEnvironment"),
                    caption: t("entityUi.modelHarness.executionCaption"),
                    extra: revertAction(revertSandbox),
                },
                body: executionBody,
            },
            // Unlike the others this is not schema-gated: the vault is a property of the agent, not
            // of its config schema, so the panel is always offered — it is the only way to reach
            // the secrets from Advanced, which is where they have always lived.
            {
                item: {
                    value: "secrets",
                    label: t("entityUi.modelHarness.customSecrets"),
                    icon: <Vault size={14} />,
                },
                header: {
                    title: t("entityUi.modelHarness.customSecrets"),
                    caption: t("entityUi.modelHarness.secretsCaption", {summary: secretsSummary}),
                    extra: <span ref={setSecretsHeaderSlot} className="flex shrink-0" />,
                },
                body: secretsBody,
            },
            agentaToolsSection && {
                item: {
                    value: "agenta-tools",
                    label: t("entityUi.modelHarness.agentaTools"),
                    icon: <Toolbox size={14} />,
                },
                body: agentaToolsSection,
            },
            hasBuildKitOverlay && {
                item: {
                    value: "build-kit",
                    label: t("entityUi.modelHarness.buildKit"),
                    icon: <Hammer size={14} />,
                },
                // The block carries its own title + enable switch, so it needs no panel header.
                body: buildKitSection,
            },
        ] as (AdvancedPanel | false)[]
    ).filter((panel): panel is AdvancedPanel => Boolean(panel))

    // Land on the first panel that owns an uncommitted change, else the first one.
    const initialAdvancedPanel =
        advancedPanels.find((panel) => panel.item.status === "warning" && panel.header)?.item
            .value ??
        advancedPanels[0]?.item.value ??
        ""
    const [advancedPanelValue, setAdvancedPanelValue] = useState(initialAdvancedPanel)
    const activeAdvancedPanel =
        advancedPanels.find((panel) => panel.item.value === advancedPanelValue) ?? advancedPanels[0]

    const activeAdvancedPanelBody = (
        // -ml/pl: the field rings keep 4px clear of the scroll clip. Keyed so each panel re-measures.
        <ScrollFadeArea
            key={activeAdvancedPanel?.item.value}
            className="-ml-1 flex min-h-0 flex-1 flex-col gap-4 pb-4 pl-1 pr-1 pt-1"
        >
            {activeAdvancedPanel?.header ? (
                <div className="flex items-start gap-2">
                    <div className="flex min-w-0 flex-1 flex-col gap-1">
                        <span className="text-sm font-medium text-colorText">
                            {activeAdvancedPanel.header.title}
                        </span>
                        <span className="text-xs leading-snug text-colorTextDescription">
                            {activeAdvancedPanel.header.caption}
                        </span>
                    </div>
                    {activeAdvancedPanel.header.extra}
                </div>
            ) : null}
            {activeAdvancedPanel?.body}
        </ScrollFadeArea>
    )

    // One panel needs no nav — a single-item rail is chrome around nothing.
    const advancedRailBody =
        advancedPanels.length > 1 ? (
            <SectionRail
                fill
                // Wider than the default rail: these labels carry an icon as well. The pt keeps
                // the focus ring clear of the body's clip and lines up with the panel title.
                railWidth="w-[112px] pt-1 sm:w-[148px]"
                drillIn
                listLabel={t("entityUi.modelHarness.advanced")}
                items={advancedPanels.map((panel) => panel.item)}
                value={activeAdvancedPanel?.item.value ?? ""}
                onChange={setAdvancedPanelValue}
            >
                {activeAdvancedPanelBody}
            </SectionRail>
        ) : (
            activeAdvancedPanelBody
        )

    // Under a focus filter the body is already narrowed, so it keeps the stack over the rail.
    const advancedDrawerBody = focus.active ? (
        <div className="flex h-full flex-col overflow-y-auto [&>*:last-child]:!border-b-0">
            {advancedControls}
        </div>
    ) : (
        <FieldLayoutProvider layout="stacked">
            <div className="flex h-full min-h-0 flex-col">{advancedRailBody}</div>
        </FieldLayoutProvider>
    )

    return {advancedSummary, advancedDrawerBody}
}
