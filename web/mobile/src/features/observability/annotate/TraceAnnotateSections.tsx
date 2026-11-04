import {useState} from "react"

import {Accordion, AccordionContent, AccordionItem, AccordionTrigger} from "@agenta/ui/ui"

import {AnnotationEvaluatorSection} from "@/features/annotations/AnnotationEvaluatorSection"

import type {TraceAnnotationSection} from "./traceAnnotationForm"

/** One open section per evaluator: its name and slug, then its metric fields. */
export const TraceAnnotateSections = ({
    sections,
    errors,
    onChange,
}: {
    sections: readonly TraceAnnotationSection[]
    errors: Record<string, Record<string, string>>
    onChange: (slug: string, fieldKey: string, value: unknown) => void
}) => {
    const [closed, setClosed] = useState<string[]>([])
    const open = sections.map((section) => section.slug).filter((slug) => !closed.includes(slug))

    return (
        <Accordion
            type="multiple"
            variant="ghost"
            value={open}
            onValueChange={(next) =>
                setClosed(
                    sections.map((section) => section.slug).filter((slug) => !next.includes(slug)),
                )
            }
        >
            {sections.map((section) => (
                <AccordionItem
                    key={section.slug}
                    value={section.slug}
                    className="border-0 border-b border-solid border-border"
                >
                    <AccordionTrigger className="bg-muted px-3 py-2.5">
                        <span className="flex min-w-0 flex-1 items-center justify-between gap-2">
                            <span className="min-w-0 truncate" title={section.name}>
                                {section.name}
                            </span>
                            <span
                                className="min-w-0 max-w-[40%] truncate text-xs text-muted-foreground"
                                title={section.slug}
                            >
                                {section.slug}
                            </span>
                        </span>
                    </AccordionTrigger>
                    <AccordionContent className="[&>div]:px-3 [&>div]:py-3">
                        <AnnotationEvaluatorSection
                            slug={section.slug}
                            fields={section.fields}
                            errors={errors[section.slug]}
                            onChange={onChange}
                        />
                    </AccordionContent>
                </AccordionItem>
            ))}
        </Accordion>
    )
}
