import {useMemo, useState} from "react"

import {
    ALL_EVALUATOR_TEMPLATES_TAB,
    evaluatorTemplateCategories,
    filterEvaluatorTemplates,
    type EvaluatorCatalogTemplate,
} from "@agenta/entities/workflow"
import {LoadError} from "@agenta/ui/components/presentational"
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
    InputGroup,
    InputGroupAddon,
    InputGroupButton,
    InputGroupInput,
    Tabs,
    TabsList,
    TabsTrigger,
} from "@agenta/ui/ui"
import {Search, X} from "lucide-react"

import {EvaluatorTemplateRow} from "./EvaluatorTemplateRow"
import {EvaluatorTemplatesNoMatch} from "./states/EvaluatorTemplatesNoMatch"
import {EvaluatorTemplatesSkeleton} from "./states/EvaluatorTemplatesSkeleton"
import {useEvaluatorTemplates} from "./useEvaluatorTemplates"

/**
 * "Create evaluator": the template catalog in a dialog. A search, one tab per category, and each
 * template with its whole description. Enter in the search picks the first match.
 *
 * The dialog mounts its body only while open, so the catalog loads on the first open.
 */
export const EvaluatorTemplatePicker = ({
    open,
    pendingKey,
    onOpenChange,
    onPick,
}: {
    open: boolean
    /** The template being prepared after a pick; the list waits for it. */
    pendingKey: string | null
    onOpenChange: (open: boolean) => void
    onPick: (template: EvaluatorCatalogTemplate) => void
}) => (
    <Dialog open={open} onOpenChange={(next) => (pendingKey ? undefined : onOpenChange(next))}>
        <DialogContent className="max-h-[min(720px,calc(100dvh-32px))] max-w-[640px] gap-3 overflow-hidden p-0">
            <DialogHeader className="px-5 pt-5">
                <DialogTitle>Create evaluator</DialogTitle>
                <DialogDescription>
                    Pick a template. You can configure and test the evaluator before you save it.
                </DialogDescription>
            </DialogHeader>
            {open ? <PickerBody pendingKey={pendingKey} onPick={onPick} /> : null}
        </DialogContent>
    </Dialog>
)

const PickerBody = ({
    pendingKey,
    onPick,
}: {
    pendingKey: string | null
    onPick: (template: EvaluatorCatalogTemplate) => void
}) => {
    const {templates, tabs, isPending, isError, refetch} = useEvaluatorTemplates()
    const [tab, setTab] = useState(ALL_EVALUATOR_TEMPLATES_TAB)
    const [search, setSearch] = useState("")
    const labels = useMemo(() => new Map(tabs.map((item) => [item.key, item.label])), [tabs])
    const shown = useMemo(
        () => filterEvaluatorTemplates(templates, {tab, search}),
        [templates, tab, search],
    )

    return (
        <>
            <div className="flex flex-col gap-3 px-5">
                <InputGroup>
                    <InputGroupAddon>
                        <Search size={14} aria-hidden />
                    </InputGroupAddon>
                    <InputGroupInput
                        autoFocus
                        value={search}
                        placeholder="Search templates"
                        aria-label="Search templates"
                        onChange={(event) => setSearch(event.target.value)}
                        onKeyDown={(event) => {
                            if (event.key !== "Enter" || !shown[0] || pendingKey) return
                            event.preventDefault()
                            onPick(shown[0])
                        }}
                    />
                    {search ? (
                        <InputGroupAddon align="inline-end">
                            <InputGroupButton
                                size="icon-xs"
                                aria-label="Clear search"
                                onClick={() => setSearch("")}
                            >
                                <X size={14} aria-hidden />
                            </InputGroupButton>
                        </InputGroupAddon>
                    ) : null}
                </InputGroup>
                <div className="-mx-1 overflow-x-auto px-1 pb-1.5">
                    <Tabs value={tab} onValueChange={setTab}>
                        <TabsList>
                            {tabs.map((item) => (
                                <TabsTrigger key={item.key} value={item.key} className="flex-none">
                                    {item.label}
                                </TabsTrigger>
                            ))}
                        </TabsList>
                    </Tabs>
                </div>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto border-0 border-t border-solid border-border px-2 py-2">
                {isError ? (
                    <LoadError title="Could not load templates" onRetry={() => void refetch()} />
                ) : isPending ? (
                    <EvaluatorTemplatesSkeleton />
                ) : shown.length === 0 ? (
                    <EvaluatorTemplatesNoMatch term={search.trim()} onClear={() => setSearch("")} />
                ) : (
                    <ul className="m-0 flex list-none flex-col gap-0.5 p-0">
                        {shown.map((template) => (
                            <li key={template.key}>
                                <EvaluatorTemplateRow
                                    template={template}
                                    categories={evaluatorTemplateCategories(template).flatMap(
                                        (key) => labels.get(key) ?? [],
                                    )}
                                    pending={pendingKey === template.key}
                                    disabled={pendingKey !== null}
                                    onPick={() => onPick(template)}
                                />
                            </li>
                        ))}
                    </ul>
                )}
            </div>
        </>
    )
}
