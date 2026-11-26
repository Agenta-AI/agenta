import {Select, SelectContent, SelectItem, SelectTrigger, SelectValue} from "@agenta/ui/ui"

export interface EndpointApp {
    id: string
    name: string
    slug: string | null
}

/** The page has no app in its address, so it picks one here. */
export const EndpointAppPicker = ({
    apps,
    value,
    onChange,
}: {
    apps: readonly EndpointApp[]
    value: string | null
    onChange: (appId: string) => void
}) => (
    <Select value={value ?? undefined} onValueChange={onChange}>
        <SelectTrigger className="w-full sm:w-72" aria-label="App" data-testid="endpoints-app">
            <SelectValue placeholder="Pick an app" />
        </SelectTrigger>
        <SelectContent>
            {apps.map((app) => (
                <SelectItem key={app.id} value={app.id}>
                    {app.name}
                </SelectItem>
            ))}
        </SelectContent>
    </Select>
)
