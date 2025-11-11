export interface SidebarUpdate {
    id: string
    title: string
    description: string
    link?: string
}

export const SIDEBAR_UPDATES: SidebarUpdate[] = [
    {
        id: "2025-05-15-annotations",
        title: "Annotate responses",
        description: "Capture user feedback with new annotation API.",
        link: "/changelog/main#annotate-your-llm-response-preview",
    },
]
