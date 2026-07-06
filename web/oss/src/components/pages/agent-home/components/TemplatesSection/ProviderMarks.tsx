import {Tooltip} from "antd"
import Image from "next/image"

import {PROVIDERS} from "../../assets/templates"

/** Brand-logo marks for a template's integrations (Composio logo CDN, rendered like catalog logos). */
const ProviderMarks = ({providers}: {providers: string[]}) => {
    if (!providers.length) return null
    return (
        <div className="flex items-center gap-1.5">
            {providers.map((slug) => {
                const provider = PROVIDERS[slug]
                if (!provider) return null
                return (
                    <Tooltip key={slug} title={provider.label}>
                        <span className="inline-flex">
                            <Image
                                src={provider.logo}
                                alt={provider.label}
                                width={16}
                                height={16}
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
