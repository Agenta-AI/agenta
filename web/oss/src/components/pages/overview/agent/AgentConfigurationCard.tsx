import {useMemo, useState} from "react"

import {HeightCollapse} from "@agenta/ui"
import {
    CaretDown,
    CaretRight,
    CpuIcon,
    FileTextIcon,
    GraduationCapIcon,
    PlugsIcon,
    SlidersHorizontalIcon,
    WrenchIcon,
} from "@phosphor-icons/react"
import {Skeleton} from "antd"
import {useAtomValue} from "jotai"

import {RAIL_CARD_CLASS} from "@/oss/assets/railCard"
import {usePlaygroundNavigation} from "@/oss/hooks/usePlaygroundNavigation"

import {agentConfigSummary} from "./agentConfigSummary"
import {agentLatestRevisionAtomFamily} from "./state"

/** An unset row says what to do about it — every row opens the playground anyway. */
const emptyAction = (label: string) => ({value: label, isAction: true})
const stated = (value: string) => ({value, isAction: false})

/**
 * What this agent IS, in one card.
 *
 * The overview could tell you how an agent had performed but never what it was configured to do,
 * so answering "which model is this on" meant opening the playground. Every row is read-only and
 * opens the playground, which is where configuration is edited — a second editing surface for the
 * same fields would be two places to change one thing.
 */
const AgentConfigurationCard = ({appId}: {appId: string}) => {
    const {goToPlayground} = usePlaygroundNavigation()
    const [instructionsOpen, setInstructionsOpen] = useState(false)
    // Configuration lives on a revision, not on the artifact — reading the artifact gave a
    // workflow with no parameters, so every row said "Not set".
    const revisionAtom = useMemo(() => agentLatestRevisionAtomFamily(appId), [appId])
    const revision = useAtomValue(revisionAtom)
    const summary = useMemo(
        () => agentConfigSummary(revision.data?.data?.parameters),
        [revision.data],
    )

    const preview = summary.instructionPreview

    // Same order and icons as the playground's config sections, so this reads as a view of that
    // panel rather than a second account of the same settings.
    const model = [summary.model, summary.harness].filter(Boolean).join(" · ")
    const advanced = [
        summary.sandbox && `Sandbox: ${summary.sandbox.toLowerCase()}`,
        summary.permissions && `Permissions: ${summary.permissions.toLowerCase()}`,
    ]
        .filter(Boolean)
        .join(" · ")

    const rows = [
        {
            key: "model",
            icon: <CpuIcon size={15} />,
            label: "Model & harness",
            ...(model ? stated(model) : emptyAction("Choose a model")),
        },
        {
            key: "instructions",
            icon: <FileTextIcon size={15} />,
            label: "Instructions",
            ...(summary.instructionWords
                ? stated(`AGENTS.md · ${summary.instructionWords} words`)
                : emptyAction("Add instructions")),
        },
        {
            key: "tools",
            icon: <WrenchIcon size={15} />,
            label: "Tools",
            ...(summary.tools ? stated(`${summary.tools} enabled`) : emptyAction("Add tools")),
        },
        {
            key: "mcps",
            icon: <PlugsIcon size={15} />,
            label: "MCP servers",
            ...(summary.mcps
                ? stated(`${summary.mcps} connected`)
                : emptyAction("Connect a server")),
        },
        {
            key: "skills",
            icon: <GraduationCapIcon size={15} />,
            label: "Skills",
            ...(summary.skills ? stated(`${summary.skills} available`) : emptyAction("Add skills")),
        },
        {
            key: "advanced",
            icon: <SlidersHorizontalIcon size={15} />,
            label: "Advanced",
            ...stated(advanced || "Defaults"),
        },
    ]

    return (
        <section className={`flex flex-col ${RAIL_CARD_CLASS}`}>
            <div className="mb-1 flex items-center justify-between gap-2">
                <h3 className="m-0 text-xs font-medium text-colorText">Configuration</h3>
                <button
                    type="button"
                    onClick={() => goToPlayground(undefined, {appId})}
                    className="cursor-pointer border-0 bg-transparent p-0 text-xs text-colorPrimary"
                >
                    Edit
                </button>
            </div>

            {revision.isPending ? <Skeleton active paragraph={{rows: 5}} title={false} /> : null}

            {revision.isPending
                ? null
                : rows.map((row) => {
                      // Instructions is the one row whose value can't be summarised in a phrase —
                      // "28 words" says how much, never what. It discloses in place; every other
                      // row's value IS the whole answer, so opening one would only cost a click.
                      const expandable = row.key === "instructions" && Boolean(preview)
                      const isOpen = expandable && instructionsOpen

                      return (
                          <div
                              key={row.key}
                              className="border-0 border-b border-solid border-colorBorderSecondary last:border-b-0"
                          >
                              <button
                                  type="button"
                                  aria-expanded={expandable ? isOpen : undefined}
                                  onClick={() =>
                                      expandable
                                          ? setInstructionsOpen((wasOpen) => !wasOpen)
                                          : goToPlayground(undefined, {appId})
                                  }
                                  className="group box-border flex w-full cursor-pointer items-center gap-3 border-0 bg-transparent px-2 py-2.5 text-left hover:bg-colorFillQuaternary"
                              >
                                  <span className="flex size-6 shrink-0 items-center justify-center rounded-md bg-colorFillQuaternary text-colorTextSecondary">
                                      {row.icon}
                                  </span>
                                  {/* Fixed label column: a right-anchored value put ~1100px of empty
                                      row between the two halves of one fact on a wide screen. */}
                                  <span className="w-32 shrink-0 text-xs font-medium text-colorText">
                                      {row.label}
                                  </span>
                                  <span
                                      className={`min-w-0 flex-1 truncate text-xs ${
                                          row.isAction
                                              ? "text-colorPrimary"
                                              : "text-colorTextSecondary"
                                      }`}
                                  >
                                      {row.value}
                                  </span>
                                  {expandable ? (
                                      <CaretDown
                                          size={14}
                                          className={`shrink-0 text-colorTextTertiary transition-transform ${
                                              isOpen ? "rotate-180" : ""
                                          }`}
                                      />
                                  ) : (
                                      <CaretRight
                                          size={14}
                                          className="shrink-0 text-colorTextTertiary"
                                      />
                                  )}
                              </button>

                              <HeightCollapse open={Boolean(isOpen)}>
                                  <button
                                      type="button"
                                      onClick={() => goToPlayground(undefined, {appId})}
                                      className="group box-border flex w-full cursor-pointer items-start gap-3 border-0 bg-transparent px-2 pb-3 pl-11 text-left"
                                  >
                                      <span className="flex size-7 shrink-0 items-center justify-center rounded-md bg-colorFillQuaternary text-colorSuccess">
                                          <FileTextIcon size={15} />
                                      </span>
                                      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                                          <span className="flex items-baseline gap-2">
                                              <span className="font-mono text-xs text-colorText">
                                                  AGENTS.md
                                              </span>
                                              <span className="text-[11px] text-colorTextTertiary">
                                                  Markdown · {summary.instructionWords} words
                                              </span>
                                          </span>
                                          {/* Two lines: enough to recognise the brief, not enough
                                              to become a reader. */}
                                          <span className="line-clamp-2 text-xs text-colorTextSecondary">
                                              {preview}
                                          </span>
                                      </span>
                                      <CaretRight
                                          size={14}
                                          className="mt-1 shrink-0 text-colorTextTertiary"
                                      />
                                  </button>
                              </HeightCollapse>
                          </div>
                      )
                  })}
        </section>
    )
}

export default AgentConfigurationCard
