import type {AppEndpointSnippets} from "@agenta/settings-ui"
import {Accordion, AccordionContent, AccordionItem, AccordionTrigger} from "@agenta/ui/ui"

import {EndpointSnippetSection} from "./EndpointSnippetSection"

/** The two ways to use a deployed app: call it, and fetch its config. One is open at a time. */
export const EndpointSnippets = ({
    invoke,
    fetchConfig,
}: {
    invoke: AppEndpointSnippets
    fetchConfig: AppEndpointSnippets
}) => (
    <Accordion type="single" collapsible defaultValue="invoke">
        <AccordionItem value="invoke">
            <AccordionTrigger>Invoke LLM App</AccordionTrigger>
            <AccordionContent>
                <EndpointSnippetSection snippets={invoke} testId="endpoints-invoke-code" />
            </AccordionContent>
        </AccordionItem>
        <AccordionItem value="config">
            <AccordionTrigger>Fetch Prompt/Config</AccordionTrigger>
            <AccordionContent>
                <EndpointSnippetSection snippets={fetchConfig} testId="endpoints-config-code" />
            </AccordionContent>
        </AccordionItem>
    </Accordion>
)
