import {ContextResolver} from "@/features/context/ContextResolver"

// `/m/w` has no picker page: resolve across the whole tree and forward, exactly as `/m/`
// does.
export default function WorkspacesPage() {
    return <ContextResolver />
}
