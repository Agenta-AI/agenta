import {DraftListRow, EntityListRow, MasterDetailRail} from "@agenta/entity-ui/drawers/shared"
import {Plus} from "@phosphor-icons/react"
import type {Meta, StoryObj} from "@storybook/nextjs"
import {Button as AntButton, Spin as AntSpin, Typography as AntTypography} from "antd"

// MasterDetailRail — the drawers' left rail ("New …" button + row list). The antd cell replays
// the pre-migration body (antd Button/Spin/Typography) verbatim from feat/storybook-data-seam;
// the row components (DraftListRow/EntityListRow) were already antd-free and are shared by both.
const meta = {
    title: "@agenta/entity-ui/Drawers/MasterDetailRail",
    component: MasterDetailRail,
    parameters: {
        layout: "padded",
        docs: {
            description: {
                component:
                    'Master-detail left rail for entity config drawers. antd `Button block icon`/`Spin`/`Typography.Text type="secondary"` → `@agenta/ui` outline `Button` (icon as child, `w-full`)/`Spinner`/plain span.',
            },
        },
    },
} satisfies Meta<typeof MasterDetailRail>

export default meta
type Story = StoryObj<typeof meta>

const noop = () => undefined

/** The pre-migration MasterDetailRail body, verbatim (antd Button + Spin + Typography). */
const AntdMasterDetailRail = ({
    newLabel,
    onNew,
    canCreate,
    isLoading,
    isEmpty,
    emptyText,
    children,
}: {
    newLabel: string
    onNew: () => void
    canCreate: boolean
    isLoading?: boolean
    isEmpty?: boolean
    emptyText: string
    children: React.ReactNode
}) => (
    <div className="flex w-[240px] shrink-0 flex-col overflow-hidden border-0 border-r border-solid border-[var(--ag-colorBorderSecondary)]">
        <div className="shrink-0 px-3 pb-2 pt-3">
            <AntButton block icon={<Plus size={14} />} onClick={onNew} disabled={!canCreate}>
                {newLabel}
            </AntButton>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-2">
            {isLoading ? (
                <div className="flex justify-center py-8">
                    <AntSpin />
                </div>
            ) : (
                <div className="flex flex-col gap-0.5">
                    {children}
                    {isEmpty && (
                        <AntTypography.Text
                            type="secondary"
                            className="!text-[11px] block px-2 py-3 leading-snug"
                        >
                            {emptyText}
                        </AntTypography.Text>
                    )}
                </div>
            )}
        </div>
    </div>
)

const rows = (
    <>
        <DraftListRow active name="" draftLabel="New schedule" onClick={noop} onRemove={noop} />
        <EntityListRow
            active={false}
            running
            title="Nightly sync"
            subtitle="Every day at 02:00"
            onClick={noop}
            onRemove={noop}
        />
        <EntityListRow
            active={false}
            running={false}
            title="Weekly digest"
            titleMuted
            subtitle="Paused"
            onClick={noop}
        />
    </>
)

const Row = ({
    label,
    isLoading,
    isEmpty,
    canCreate = true,
    children,
}: {
    label: string
    isLoading?: boolean
    isEmpty?: boolean
    canCreate?: boolean
    children?: React.ReactNode
}) => (
    <div className="grid grid-cols-[10rem_1fr_1fr] items-start gap-4 border-b border-colorBorderSecondary py-3">
        <div className="text-xs text-colorTextSecondary">{label}</div>
        <div className="flex flex-col gap-1">
            <span className="text-[10px] text-colorTextSecondary">antd</span>
            <div className="h-[190px] w-[250px]" data-vrt-subject>
                <AntdMasterDetailRail
                    newLabel="New schedule"
                    onNew={noop}
                    canCreate={canCreate}
                    isLoading={isLoading}
                    isEmpty={isEmpty}
                    emptyText="No schedules yet. Create one to get started."
                >
                    {children}
                </AntdMasterDetailRail>
            </div>
        </div>
        <div className="flex flex-col gap-1">
            <span className="text-[10px] text-colorTextSecondary">agenta</span>
            <div className="h-[190px] w-[250px]" data-vrt-subject>
                <MasterDetailRail
                    newLabel="New schedule"
                    onNew={noop}
                    canCreate={canCreate}
                    isLoading={isLoading}
                    isEmpty={isEmpty}
                    emptyText="No schedules yet. Create one to get started."
                >
                    {children}
                </MasterDetailRail>
            </div>
        </div>
    </div>
)

export const AntdVsAgenta: Story = {
    args: {
        newLabel: "New schedule",
        onNew: noop,
        canCreate: true,
        emptyText: "No schedules yet.",
        children: rows,
    },
    render: () => (
        <div className="flex max-w-[900px] flex-col">
            <Row label="with rows">{rows}</Row>
            <Row label="loading" isLoading />
            <Row label="empty" isEmpty />
            <Row label="cannot create" canCreate={false} isEmpty />
        </div>
    ),
}
