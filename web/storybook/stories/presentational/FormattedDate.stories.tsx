import {dayjs} from "@agenta/shared/utils"
import {FormattedDate} from "@agenta/ui/components/presentational"
import {Copy} from "@phosphor-icons/react"
import type {Meta, StoryObj} from "@storybook/nextjs"
import {Tag, Tooltip} from "antd"

// FormattedDate — a presentational date formatter (dayjs) that copies the raw ISO value on click.
// It WAS built on antd `Tooltip` + `Tag variant="filled"` and was migrated to the @agenta/ui
// Tooltip + Badge, so the antd column reproduces that pre-migration body.
const meta = {
    title: "@agenta/ui/Presentational/Labels/FormattedDate",
    component: FormattedDate,
    parameters: {
        layout: "padded",
        docs: {
            description: {
                component:
                    'A presentational date formatter (dayjs) that copies the raw ISO value on click, with an optional badge wrapper. Migrated from antd `Tooltip` + `Tag variant="filled"` to the @agenta/ui Tooltip + Badge; shown beside the antd markup it replaces.\n\n**Used in:** 1 place — the workflow revision drawer metadata sidebar (`@agenta/playground-ui`).',
            },
        },
    },
} satisfies Meta

export default meta
type Story = StoryObj

const SAMPLE = "2026-07-24T14:32:00.000Z"

/**
 * Verbatim reproduction of the pre-migration antd body (commit 7a8ba37a37): antd `Tooltip`
 * around the same span, antd `Tag variant="filled"` for `asTag`. The one deliberate swap is the
 * tag background: the original hard-coded the `--ag-c-0517290F` compat shim, which resolves to
 * `colorFillTertiary` in dark and to the same colour within 2% alpha in light — using the token
 * on both sides keeps the pair about antd Tag vs @agenta/ui Badge, not about that swap.
 */
const AntdFormattedDate = ({
    date,
    format = "MMM D, YYYY h:mm A",
    fallback = "-",
    asTag = false,
}: {
    date: string | null
    format?: string
    fallback?: string
    asTag?: boolean
}) => {
    // `text-zinc-6` is what the component's `textColors.muted` resolves to, before and after
    // the migration — spelling it out keeps the fallback row a like-for-like pair.
    if (date == null) return <span className="text-zinc-6">{fallback}</span>

    const parsed = dayjs(date)
    if (!parsed.isValid()) return <span className="text-zinc-6">{fallback}</span>

    // `copied` is always false in a static shot, so only the idle (hover-hidden) icon renders.
    const icon = (
        <Copy
            size={12}
            className="flex-shrink-0 opacity-0 group-hover/date:opacity-100 transition-opacity"
        />
    )

    const inner = (
        <Tooltip title={`Click to copy: ${date}`} mouseEnterDelay={0.4}>
            <span className="group/date inline-flex items-center gap-1 cursor-pointer">
                {parsed.format(format)}
                {icon}
            </span>
        </Tooltip>
    )

    if (asTag) {
        return (
            <Tag variant="filled" className="bg-colorFillTertiary">
                {inner}
            </Tag>
        )
    }

    return inner
}

// Both cells carry the SAME typography context (`text-xs text-colorText`): FormattedDate renders a
// bare span with no font size of its own, so an asymmetric context would show up as a font diff
// that no component owns. `data-vrt-subject` opts that bare span in as the harness subject —
// without it the cell falls back to `firstElementChild`, i.e. the "antd"/"agenta" caption.
const Row = ({label, a, s}: {label: string; a: React.ReactNode; s: React.ReactNode}) => (
    <div className="grid grid-cols-[12rem_1fr_1fr] items-center gap-4 border-b border-colorBorderSecondary py-3">
        <div className="text-xs text-colorTextSecondary">{label}</div>
        <div className="flex items-center gap-2">
            <span className="w-8 shrink-0 text-[10px] text-colorTextSecondary">antd</span>
            <span data-vrt-subject className="inline-flex items-center text-xs text-colorText">
                {a}
            </span>
        </div>
        <div className="flex items-center gap-2">
            <span className="w-8 shrink-0 text-[10px] text-colorTextSecondary">agenta</span>
            <span data-vrt-subject className="inline-flex items-center text-xs text-colorText">
                {s}
            </span>
        </div>
    </div>
)

export const AntdVsAgenta: Story = {
    render: () => (
        <div className="flex max-w-[820px] flex-col">
            <Row
                label="default"
                a={<AntdFormattedDate date={SAMPLE} />}
                s={<FormattedDate date={SAMPLE} />}
            />
            <Row
                label="custom format"
                a={<AntdFormattedDate date={SAMPLE} format="YYYY-MM-DD" />}
                s={<FormattedDate date={SAMPLE} format="YYYY-MM-DD" />}
            />
            <Row
                label="asTag"
                a={<AntdFormattedDate date={SAMPLE} asTag />}
                s={<FormattedDate date={SAMPLE} asTag />}
            />
            <Row
                label="null → fallback"
                a={<AntdFormattedDate date={null} fallback="Never" />}
                s={<FormattedDate date={null} fallback="Never" />}
            />
        </div>
    ),
}
