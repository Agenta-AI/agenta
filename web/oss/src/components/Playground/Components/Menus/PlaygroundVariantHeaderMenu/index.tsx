import {useCallback, useMemo} from "react"

import {workflowMolecule} from "@agenta/entities/workflow"
import {
    playgroundController,
    isAgentModeAtomFamily,
    agentChannelModeAtom,
    type AgentChannelMode,
} from "@agenta/playground"
import {message} from "@agenta/ui/app-message"
import {MoreOutlined} from "@ant-design/icons"
import {ArrowCounterClockwise, Check, Trash} from "@phosphor-icons/react"
import {Button, Dropdown, MenuProps} from "antd"
import {useAtomValue, useSetAtom} from "jotai"

import DeleteVariantButton from "../../Modals/DeleteVariantModal/assets/DeleteVariantButton"

import {PlaygroundVariantHeaderMenuProps} from "./types"

// Stream (token-by-token) vs batch (one-shot) response channel for the agent run lane.
const CHANNEL_OPTIONS: {value: AgentChannelMode; label: string}[] = [
    {value: "stream", label: "Stream"},
    {value: "batch", label: "Batch"},
]

const PlaygroundVariantHeaderMenu: React.FC<PlaygroundVariantHeaderMenuProps> = ({
    variantId,
    ...props
}) => {
    const selectedVariants = useAtomValue(playgroundController.selectors.entityIds())
    const removeVariantFromSelection = useSetAtom(playgroundController.actions.removeEntity)
    const isDirty = useAtomValue(workflowMolecule.selectors.isDirty(variantId || ""))
    // Stream vs batch response channel for the agent run lane. (The layout selector lives in the
    // playground header, not this menu — see PlaygroundHeader.) Agent mode derives from the
    // backend is_agent flag; non-agent variants hide these items.
    const isAgent = useAtomValue(isAgentModeAtomFamily(variantId || ""))
    const channelMode = useAtomValue(agentChannelModeAtom)
    const setChannelMode = useSetAtom(agentChannelModeAtom)

    const closePanelDisabled = useMemo(() => {
        return selectedVariants.length === 1 && selectedVariants.includes(variantId)
    }, [selectedVariants, variantId])

    const handleClosePanel = useCallback(() => {
        removeVariantFromSelection(variantId)
    }, [removeVariantFromSelection, variantId])

    const handleDiscardDraft: NonNullable<MenuProps["onClick"]> = (e) => {
        e?.domEvent?.stopPropagation()
        if (!variantId) return
        try {
            workflowMolecule.set.discard(variantId)
            message.success("Draft changes discarded")
        } catch (err) {
            message.error("Failed to discard draft changes")
            console.error(err)
        }
    }

    const items: MenuProps["items"] = useMemo(
        () => [
            ...(isAgent
                ? [
                      {
                          key: "channel",
                          type: "group" as const,
                          label: "Response",
                          children: CHANNEL_OPTIONS.map((option) => ({
                              key: `channel-${option.value}`,
                              label: option.label,
                              icon:
                                  channelMode === option.value ? (
                                      <Check size={14} />
                                  ) : (
                                      <span className="inline-block w-[14px]" />
                                  ),
                              onClick: (e: {domEvent: {stopPropagation: () => void}}) => {
                                  e.domEvent.stopPropagation()
                                  setChannelMode(option.value)
                              },
                          })),
                      },
                      {type: "divider" as const},
                  ]
                : []),
            {
                key: "revert",
                label: "Revert Changes",
                icon: <ArrowCounterClockwise size={14} />,
                onClick: handleDiscardDraft,
                disabled: !variantId || !isDirty,
            },
            {
                key: "delete",
                danger: true,
                label: (
                    <DeleteVariantButton variantId={variantId}>
                        <div className="w-full h-full">Delete</div>
                    </DeleteVariantButton>
                ),
                icon: <Trash size={16} />,
            },
            {type: "divider"},
            {
                key: "close",
                label: "Close panel",
                disabled: closePanelDisabled,
                onClick: (e) => {
                    e.domEvent.stopPropagation()
                    handleClosePanel()
                },
            },
        ],
        [handleClosePanel, closePanelDisabled, variantId, handleDiscardDraft, isDirty],
    )

    return (
        <Dropdown trigger={["click"]} styles={{root: {width: 170}}} menu={{items}} {...props}>
            <Button icon={<MoreOutlined size={14} />} type="text" />
        </Dropdown>
    )
}

export default PlaygroundVariantHeaderMenu
