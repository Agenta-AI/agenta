import {useState} from "react"

import {SkillsGalleryPage, type SkillListItem} from "@agenta/skills-ui"
import type {Meta, StoryObj} from "@storybook/nextjs"

// The registry page: source rail + search + sectioned card grid (artboard 1).
const meta = {
    title: "@agenta/skills-ui/SkillsGalleryPage",
    component: SkillsGalleryPage,
    parameters: {
        layout: "fullscreen",
        docs: {
            description: {
                component:
                    "The skill registry browse page on FilterRailLayout: a source rail " +
                    "(All / This project / Agenta / per-imported-repo with counts), search, " +
                    "and sectioned 3-column card grids. One `+ New skill ▾` action.",
            },
        },
    },
} satisfies Meta<typeof SkillsGalleryPage>

export default meta
type Story = StoryObj<typeof meta>

const noop = () => undefined

const PROJECT_SKILLS: SkillListItem[] = [
    {
        id: "s1",
        slug: "pdf-tools",
        name: "PDF tools",
        description: "Extract text, merge, and split PDF documents with qpdf and pdfplumber.",
        origin: "project",
        version: "3",
        filesCount: 4,
        usedByCount: 2,
        age: "3d ago",
    },
    {
        id: "s2",
        slug: "release-notes",
        name: "Release notes",
        description: "Draft release notes from merged PRs in the house style.",
        origin: "project",
        version: "1",
        filesCount: 1,
        usedByCount: 1,
        age: "1w ago",
    },
]

const IMPORTED_SKILLS: SkillListItem[] = [
    {
        id: "s3",
        slug: "commit-helper",
        name: "Commit helper",
        description: "Conventional-commit message guidance imported from anthropics/skills.",
        origin: "imported",
        version: "2",
        filesCount: 2,
        usedByCount: 0,
        age: "5d ago",
    },
]

const BUILTIN_SKILLS: SkillListItem[] = [
    {
        id: "s4",
        slug: "__ag__web-search",
        name: "Web search",
        description: "Search the web and cite sources. Provided and maintained by Agenta.",
        origin: "builtin",
    },
]

const SOURCES = [
    {key: "all", label: "All skills", count: 4},
    {key: "project", label: "This project", count: 2},
    {key: "agenta", label: "Agenta", count: 1},
    {key: "anthropics-skills", label: "anthropics/skills", count: 1},
]

function GalleryHarness({empty}: {empty?: boolean}) {
    const [source, setSource] = useState("all")
    const [search, setSearch] = useState("")
    return (
        <div className="flex h-screen flex-col">
            <SkillsGalleryPage
                sources={empty ? [{key: "all", label: "All skills", count: 0}] : SOURCES}
                selectedSource={source}
                onSelectSource={setSource}
                search={search}
                onSearchChange={setSearch}
                sections={
                    empty
                        ? []
                        : [
                              {key: "project", label: "This project", skills: PROJECT_SKILLS},
                              {
                                  key: "anthropics-skills",
                                  label: "anthropics/skills",
                                  tag: "synced 5d ago",
                                  skills: IMPORTED_SKILLS,
                              },
                              {key: "agenta", label: "Agenta", skills: BUILTIN_SKILLS},
                          ]
                }
                onOpenSkill={noop}
                createActions={{onWrite: noop, onUpload: noop, onImport: noop}}
            />
        </div>
    )
}

export const Populated: Story = {
    args: {} as never,
    render: () => <GalleryHarness />,
}

export const Empty: Story = {
    args: {} as never,
    render: () => <GalleryHarness empty />,
}
