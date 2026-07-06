import {Tooltip} from "antd"
import Image from "next/image"

import {PROVIDERS} from "../../assets/templates"

/** Provider icon chips for a template's integrations (Composio logo CDN), used by the template cards. */
const ProviderMarks = ({providers}: {providers: string[]}) => {
    if (!providers.length) return null
    return (
        <div className="flex items-center gap-[5px]">
            {providers.map((slug) => {
                const provider = PROVIDERS[slug]
                if (!provider) return null
                return (
                    <Tooltip key={slug} title={provider.label}>
                        <span className="flex size-[26px] shrink-0 items-center justify-center rounded-[7px] border border-solid border-[var(--ag-colorBorderSecondary)] bg-[var(--ag-colorBgContainer)]">
                            <Image
                                src={provider.logo}
                                alt={provider.label}
                                width={14}
                                height={14}
                                unoptimized
                                className="shrink-0 rounded object-contain"
                            />
                        </span>
                    </Tooltip>
                )
            })}
        </div>
    )
}

export default ProviderMarks
