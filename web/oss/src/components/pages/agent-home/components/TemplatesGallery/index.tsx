import {useCallback, useEffect, useState} from "react"

import {
    ALL_TEMPLATES_CATEGORY,
    categoryFromSlug,
    categorySlug,
    type AgentStarterTemplate,
} from "@agenta/entities/workflow"
import {TemplateGallery} from "@agenta/home-ui"
import {PageLayout} from "@agenta/ui"
import {App} from "antd"
import {useAtomValue} from "jotai"
import {useRouter} from "next/router"


import {urlAtom} from "@/oss/state/url"

import {TEMPLATES_GALLERY} from "../../assets/constants"
import TemplateSetupDrawer, {type TemplateSetupResult} from "../TemplateSetupDrawer"

/**
 * The templates gallery route: the SHARED gallery (rail + search + card sections) under this app's
 * page chrome. What stays here is this app's — the `?category=` deep link, the
 * detail-page navigation a card click opens, and the setup drawer.
 */
const TemplatesGalleryPage = () => {
    const router = useRouter()
    const {message} = App.useApp()
    const {baseAppURL} = useAtomValue(urlAtom)
    const [active, setActive] = useState(ALL_TEMPLATES_CATEGORY)


    // Deep link: `?category=engineering` opens with that rail item active.
    useEffect(() => {
        if (!router.isReady) return
        const slug = router.query.category
        setActive(categoryFromSlug(Array.isArray(slug) ? slug[0] : slug))
    }, [router.isReady, router.query.category])

    const handleCategoryChange = useCallback(
        (category: string) => {
            setActive(category)
            const {category: _drop, ...rest} = router.query
            router.replace(
                {
                    pathname: router.pathname,
                    query:
                        category === ALL_TEMPLATES_CATEGORY
                            ? rest
                            : {...rest, category: categorySlug(category)},
                },
                undefined,
                {shallow: true},
            )
        },
        [router],
    )

    // A card opens the template rather than creating from it: the detail page is where you find
    // out what it needs before committing, which is the point of having one.
    const handleSelectTemplate = useCallback(
        (template: AgentStarterTemplate) =>
            void router.push(`${baseAppURL}/agent-templates/${template.key}`),
        [router, baseAppURL],
    )

    // TODO(Phase B): create the ephemeral draft from the template + open the playground.
    const [setupTemplate, setSetupTemplate] = useState<AgentStarterTemplate | null>(null)
    const handleTemplateCreate = useCallback(
        ({template, name}: TemplateSetupResult) => {
            setSetupTemplate(null)
            message.info(`Create "${name}" from ${template.name} — wiring in the next phase`)
        },
        [message],
    )

    return (
        <PageLayout className="grow min-h-0 !p-0">
            <TemplateGallery
                category={active}
                onCategoryChange={handleCategoryChange}
                onSelectTemplate={handleSelectTemplate}
                title={TEMPLATES_GALLERY.title}
                subtitle={TEMPLATES_GALLERY.subtitle}
                searchPlaceholder={TEMPLATES_GALLERY.searchPlaceholder}
            />

            <TemplateSetupDrawer
                template={setupTemplate}
                open={!!setupTemplate}
                onClose={() => setSetupTemplate(null)}
                onCreate={handleTemplateCreate}
            />
        </PageLayout>
    )
}

export default TemplatesGalleryPage
