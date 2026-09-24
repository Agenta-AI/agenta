import {useCallback, useEffect, useState} from "react"

import {
    ALL_TEMPLATES_CATEGORY,
    categoryFromSlug,
    categorySlug,
    type AgentStarterTemplate,
} from "@agenta/entities/workflow"
import {TEMPLATE_GALLERY_COPY, TemplateGallery} from "@agenta/home-ui"
import {PageLayout} from "@agenta/ui"
import {pageContentWidthClass} from "@agenta/ui/components/page-width"
import clsx from "clsx"
import {useAtomValue} from "jotai"
import {useRouter} from "next/router"

import {urlAtom} from "@/oss/state/url"

import {BROWSE_RAIL_MODE} from "../../assets/constants"

/**
 * The templates gallery route: the SHARED gallery (categories + search + card sections) under this
 * app's page chrome. What stays here is this app's — the `?category=` deep link, the
 * detail-page navigation a card click opens.
 *
 * `BROWSE_RAIL_MODE` picks the shell: by default the page owns the title and gutters and the
 * gallery renders inside that column (#5846); opt in and it goes back to the bled-to-the-edge rail.
 */
const TemplatesGalleryPage = () => {
    const router = useRouter()
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

    if (!BROWSE_RAIL_MODE)
        return (
            // The page's own title, description and gutters (#5846), so the gallery shares one
            // column width with the rest of the app; the categories and search sit inside it.
            <PageLayout
                className={clsx(pageContentWidthClass, "grow min-h-0")}
                title={TEMPLATE_GALLERY_COPY.title}
                description={TEMPLATE_GALLERY_COPY.subtitle}
            >
                {/* No `title`/`subtitle` here — `PageLayout` carries them in the toolbar layout. */}
                <TemplateGallery
                    layout="toolbar"
                    category={active}
                    onCategoryChange={handleCategoryChange}
                    onSelectTemplate={handleSelectTemplate}
                    searchPlaceholder={TEMPLATE_GALLERY_COPY.searchPlaceholder}
                />
            </PageLayout>
        )

    return (
        <PageLayout className="grow min-h-0 !p-0">
            <TemplateGallery
                layout="rail"
                category={active}
                onCategoryChange={handleCategoryChange}
                onSelectTemplate={handleSelectTemplate}
                title={TEMPLATE_GALLERY_COPY.title}
                subtitle={TEMPLATE_GALLERY_COPY.subtitle}
                searchPlaceholder={TEMPLATE_GALLERY_COPY.searchPlaceholder}
            />
        </PageLayout>
    )
}

export default TemplatesGalleryPage
