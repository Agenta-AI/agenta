import type {ReactNode} from "react"

import {Accordion, AccordionContent, AccordionItem, AccordionTrigger} from "@agenta/ui/ui"

/** A titled block of the Configuration tab that the reader can fold. Open at first. */
export const QueueConfigSection = ({title, children}: {title: string; children: ReactNode}) => (
    <Accordion type="single" collapsible defaultValue="section" className="bg-card">
        <AccordionItem value="section">
            <AccordionTrigger caret="end" className="font-semibold">
                {title}
            </AccordionTrigger>
            <AccordionContent className="[&>div]:p-0">{children}</AccordionContent>
        </AccordionItem>
    </Accordion>
)
