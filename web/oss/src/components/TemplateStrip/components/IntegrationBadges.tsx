import Image from "next/image"

import {PROVIDERS} from "@/oss/components/pages/agent-home/assets/templates"

/**
 * Overlapping brand-logo badges for a template's integrations. Tiles stay WHITE in dark
 * mode so the brand logos keep their contrast (deliberate, see design.md section 7).
 * "card" = 24px overlapping squares; "chip" = 18px squares with a 3px gap, no overlap.
 */
const IntegrationBadges = ({slugs, size = "card"}: {slugs: string[]; size?: "card" | "chip"}) => {
    if (!slugs.length) return null
    const chip = size === "chip"
    return (
        <div className={`flex items-center ${chip ? "gap-[3px]" : ""}`}>
            {slugs.map((slug, index) => {
                const provider = PROVIDERS[slug]
                if (!provider) return null
                return (
                    <span
                        key={slug}
                        className={`flex shrink-0 items-center justify-center border border-solid border-[var(--ag-colorBorderSecondary)] bg-[var(--ag-colorWhite)] ${
                            chip
                                ? "size-[18px] rounded-[5px]"
                                : `size-6 rounded-md ${index > 0 ? "-ml-1.5" : ""}`
                        }`}
                    >
                        <Image
                            src={provider.logo}
                            alt={provider.label}
                            width={chip ? 11 : 14}
                            height={chip ? 11 : 14}
                            unoptimized
                            className="shrink-0 rounded object-contain"
                        />
                    </span>
                )
            })}
        </div>
    )
}

export default IntegrationBadges
