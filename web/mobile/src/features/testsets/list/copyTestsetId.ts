import {message} from "@agenta/ui/app-message"
import {copyToClipboard} from "@agenta/ui/utils"

/** Copies a test set's id for SDK and API calls, and says whether it worked. */
export const copyTestsetId = async (id: string): Promise<void> => {
    if (await copyToClipboard(id)) message.success("Test set ID copied")
    else message.error("Couldn't copy the ID")
}
