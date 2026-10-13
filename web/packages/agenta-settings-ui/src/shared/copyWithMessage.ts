import {message} from "@agenta/ui/app-message"
import {copyToClipboard} from "@agenta/ui/utils"

/** Copy and say how it went; a missing clipboard (plain HTTP) reports the failure too. */
export const copyWithMessage = async (text: string, copied: string, failed: string) => {
    if (await copyToClipboard(text)) message.success(copied)
    else message.error(failed)
}
