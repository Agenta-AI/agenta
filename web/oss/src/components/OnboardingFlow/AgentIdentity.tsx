import {useEffect, useState} from "react"

import {agentIconAtomFamily} from "@agenta/entities/workflow"
import {
    AgentIcon,
    AGENT_ICON_COLORS,
    loadAgentIconCatalog,
    type PhosphorCatalogEntry,
} from "@agenta/ui/agent-icon"
import {Robot} from "@phosphor-icons/react"
import {useAtom} from "jotai"

const glyphNames = [
    "robot",
    "git-pull-request",
    "bug",
    "lightning",
    "shield-check",
    "chat-circle-dots",
    "megaphone",
    "chart-line-up",
]

export default function AgentIdentity({entityId}: {entityId: string}) {
    const [record, setRecord] = useAtom(agentIconAtomFamily(entityId))
    const [glyphs, setGlyphs] = useState<PhosphorCatalogEntry[]>([])
    useEffect(() => {
        let active = true
        void loadAgentIconCatalog()
            .then((items) => {
                if (active)
                    setGlyphs(
                        glyphNames.flatMap((name) => items.filter((item) => item.name === name)),
                    )
            })
            .catch(() => {})
        return () => {
            active = false
        }
    }, [])
    const color = record?.color ?? AGENT_ICON_COLORS[0][0]
    const chosen = glyphs.find((item) => item.name === record?.icon) ?? glyphs[0]
    return (
        <div className="mb-7 flex flex-col items-center">
            <span
                className="mb-5 flex h-24 w-24 items-center justify-center rounded-[22px] text-white"
                style={{backgroundColor: color}}
            >
                {chosen ? <AgentIcon path={chosen.path} size={46} /> : <Robot size={46} />}
            </span>
            <div className="mb-3 flex gap-3">
                {AGENT_ICON_COLORS.slice(0, 8).map(([tone]) => (
                    <button
                        type="button"
                        key={tone}
                        aria-label={`Agent color ${tone}`}
                        aria-pressed={tone === color}
                        disabled={!chosen}
                        className="h-6 w-6 rounded-full border-2 border-solid border-colorBgContainer aria-pressed:outline aria-pressed:outline-2 aria-pressed:outline-colorText"
                        style={{backgroundColor: tone}}
                        onClick={() => {
                            if (chosen)
                                setRecord({icon: chosen.name, path: chosen.path, color: tone})
                        }}
                    />
                ))}
            </div>
            <div className="flex gap-2">
                {glyphs.map((glyph) => (
                    <button
                        type="button"
                        key={glyph.name}
                        aria-label={`Agent icon ${glyph.name}`}
                        aria-pressed={chosen?.name === glyph.name}
                        className="flex h-9 w-9 items-center justify-center rounded-lg border border-solid border-transparent bg-transparent text-colorPrimary aria-pressed:border-colorText"
                        onClick={() => setRecord({icon: glyph.name, path: glyph.path, color})}
                    >
                        <AgentIcon path={glyph.path} size={20} />
                    </button>
                ))}
            </div>
        </div>
    )
}
