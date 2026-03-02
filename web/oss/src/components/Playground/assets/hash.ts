import crypto from "crypto"

import {updateMetadataAtom} from "@agenta/entities/legacyAppRevision"
import stableHash from "stable-hash"

import {updateResponseAtom} from "@/oss/lib/hooks/useStatelessVariants/state"

const hashCache = new WeakMap()

export const hash = (value: any) => {
    if (hashCache.has(value)) return hashCache.get(value)

    const weakHash = stableHash(value)
    const safeHash = crypto.createHash("MD5").update(weakHash).digest("hex")

    if (value) {
        hashCache.set(value, safeHash)
    }
    return safeHash
}

export const hashMetadata = (metadata: any) => {
    if (typeof metadata === "string") {
        return metadata
    } else {
        const metadataHash = hash(metadata)
        updateMetadataAtom({[metadataHash]: metadata})

        return metadataHash
    }
}

export const hashResponse = (response: any) => {
    if (typeof response === "string") {
        return response
    } else {
        const responseHash = hash(response)
        updateResponseAtom({[responseHash]: response})

        return responseHash
    }
}
