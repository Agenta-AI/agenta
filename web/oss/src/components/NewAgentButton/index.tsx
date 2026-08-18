import {ArrowRightIcon, PlusIcon} from "@phosphor-icons/react"
import {Button, Dropdown} from "antd"
import Link from "next/link"
import {useRouter} from "next/router"

import {AGENT_TEMPLATES} from "@/oss/components/pages/agent-home/assets/templates"
import useURL from "@/oss/hooks/useURL"

/** Enough to recognise the shape of what's on offer; the rest is one click away. */
const SUGGESTED = 4

/**
 * The one way to create an agent: blank, or from a template.
 *
 * Both land on the same create surface (`?new=1`), so a template pick is a seed rather than a
 * separate flow — the alternative was a plain button that hid templates behind a rail section and
 * a gallery nobody could reach.
 */
const NewAgentButton = ({label = "New agent"}: {label?: string}) => {
    const router = useRouter()
    const {baseAppURL} = useURL()

    const goCreate = (templateKey?: string) =>
        void router.push(
            templateKey ? `${baseAppURL}?new=1&template=${templateKey}` : `${baseAppURL}?new=1`,
        )

    return (
        <Dropdown
            trigger={["click"]}
            placement="bottomRight"
            menu={{
                items: [
                    {
                        key: "blank",
                        label: (
                            <div className="flex flex-col py-0.5">
                                <span className="text-sm text-colorText">Blank agent</span>
                                <span className="text-xs text-colorTextTertiary">
                                    Configure model, instructions and tools yourself
                                </span>
                            </div>
                        ),
                        icon: <PlusIcon size={16} />,
                        onClick: () => goCreate(),
                    },
                    {type: "divider"},
                    {key: "templates-label", type: "group", label: "Templates"},
                    ...AGENT_TEMPLATES.slice(0, SUGGESTED).map((template) => ({
                        key: template.key,
                        label: (
                            <div className="flex items-center gap-2 py-0.5">
                                <span
                                    aria-hidden
                                    className="flex size-7 shrink-0 items-center justify-center rounded-md text-xs font-semibold text-white"
                                    style={{background: template.color}}
                                >
                                    {template.initials}
                                </span>
                                <span className="flex min-w-0 flex-col">
                                    <span className="truncate text-sm text-colorText">
                                        {template.name}
                                    </span>
                                    <span className="truncate text-xs text-colorTextTertiary">
                                        {template.description}
                                    </span>
                                </span>
                            </div>
                        ),
                        onClick: () => goCreate(template.key),
                    })),
                    {type: "divider"},
                    {
                        key: "browse",
                        label: (
                            <Link
                                href={`${baseAppURL}/agent-templates`}
                                className="inline-flex items-center gap-1 !text-colorPrimary"
                            >
                                Browse all {AGENT_TEMPLATES.length} templates
                                <ArrowRightIcon size={12} />
                            </Link>
                        ),
                    },
                ],
            }}
        >
            <Button type="primary" icon={<PlusIcon size={14} />}>
                {label}
            </Button>
        </Dropdown>
    )
}

export default NewAgentButton
