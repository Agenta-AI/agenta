import {useState} from "react"

import type {OrganizationDomain} from "@agenta/entities/organization"
import {Button} from "@agenta/ui/ui"
import {copyToClipboard} from "@agenta/ui/utils"
import {Check, Copy} from "@phosphor-icons/react"

/** The DNS TXT record that the backend verifies for an unverified domain. */
export const DomainDnsInstructions = ({domain}: {domain: OrganizationDomain}) => {
    const [copied, setCopied] = useState(false)
    if (!domain.token) return null

    const name = `_agenta-verification.${domain.slug}`
    const value = `_agenta-verification=${domain.token}`

    return (
        <div className="flex flex-col gap-2 rounded-md border border-solid border-border bg-muted px-3 py-2 text-xs">
            <p className="m-0 text-muted-foreground">
                Add this DNS record at your domain provider, then press Verify.
            </p>
            <div className="flex flex-col gap-1 font-mono">
                <span className="break-all">Name: {name}</span>
                <span>Type: TXT</span>
                <span className="break-all">Value: {value}</span>
            </div>
            <div>
                <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={async () => setCopied(await copyToClipboard(value))}
                >
                    {copied ? <Check size={14} /> : <Copy size={14} />}
                    {copied ? "Copied" : "Copy value"}
                </Button>
            </div>
        </div>
    )
}
