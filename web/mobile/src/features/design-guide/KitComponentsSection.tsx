import type {ReactNode} from "react"

import {
    Alert,
    Badge,
    Button,
    Checkbox,
    EmptyState,
    Field,
    IconTile,
    Input,
    Kbd,
    Spinner,
    Switch,
    Tabs,
    TabsList,
    TabsTrigger,
} from "@agenta/ui/ui"
import {CompassIcon, MagnifyingGlassIcon, PlusIcon, RobotIcon} from "@phosphor-icons/react"

import {OverlaysRow} from "./OverlaysRow"

const buttonVariants = [
    "default",
    "secondary",
    "outline",
    "ghost",
    "destructive-ghost",
    "destructive",
    "brand",
    "link",
] as const
const buttonSizes = ["xs", "sm", "default", "lg"] as const
const badgeVariants = ["default", "success", "warning", "destructive", "info"] as const

function Row({label, children}: {label: string; children: ReactNode}) {
    return (
        <div className="flex flex-col gap-2">
            <div className="text-meta text-muted-foreground">{label}</div>
            <div className="flex flex-wrap items-center gap-2">{children}</div>
        </div>
    )
}

export function KitComponentsSection() {
    return (
        <section className="flex flex-col gap-6">
            <Row label="Button variants">
                {buttonVariants.map((v) => (
                    <Button key={v} variant={v}>
                        {v}
                    </Button>
                ))}
            </Row>
            <Row label="Button sizes">
                {buttonSizes.map((s) => (
                    <Button key={s} size={s} variant="outline">
                        <PlusIcon /> {s}
                    </Button>
                ))}
                <Button size="icon" variant="ghost" aria-label="Search">
                    <MagnifyingGlassIcon />
                </Button>
            </Row>
            <Row label="Input">
                <div className="w-64">
                    <Input placeholder="Search agents" />
                </div>
                <div className="w-64">
                    <Input defaultValue="weekly-report" disabled />
                </div>
            </Row>
            <Row label="Field: help on the label, error under the control">
                <div className="w-64">
                    <Field
                        label="Agent name"
                        tooltip="Shown in the sidebar and in shared links."
                        error="Use letters, numbers and dashes."
                    >
                        <Input defaultValue="weekly report!" aria-invalid />
                    </Field>
                </div>
            </Row>
            <Row label={`Badge variants (${badgeVariants.length})`}>
                {badgeVariants.map((v) => (
                    <Badge key={v} variant={v}>
                        {v}
                    </Badge>
                ))}
            </Row>
            <Row label="Checkbox, Switch, Kbd">
                <Checkbox defaultChecked /> <Checkbox /> <Switch defaultChecked /> <Switch />{" "}
                <Kbd>⌘K</Kbd>
            </Row>
            <Row label="Mark · 16 / 20 / 24 / 32 / 40">
                {([16, 20, 24, 32, 40] as const).map((size) => (
                    <IconTile key={size} size={size}>
                        <RobotIcon />
                    </IconTile>
                ))}
                <IconTile size={24}>
                    <CompassIcon />
                </IconTile>
                <IconTile size={24} tone="brand">
                    D
                </IconTile>
            </Row>
            <Row label="Menu, Select, Dialog · bottom sheets on a compact window">
                <OverlaysRow />
            </Row>
            <Row label="Tabs">
                <Tabs defaultValue="agents">
                    <TabsList>
                        <TabsTrigger value="agents">Your agents</TabsTrigger>
                        <TabsTrigger value="templates">Templates</TabsTrigger>
                        <TabsTrigger value="archived">Archived</TabsTrigger>
                    </TabsList>
                </Tabs>
            </Row>
            <Row label="Alert">
                <div className="grid w-full gap-3 sm:grid-cols-2">
                    <Alert type="success" showIcon message="Agent published" closable />
                    <Alert type="info" showIcon message="This agent runs every Monday at 09:00." />
                    <Alert type="warning" showIcon message="2 tools need your approval" />
                    <Alert type="error" showIcon message="Slack is disconnected" />
                </div>
            </Row>
            <Row label="Spinner, EmptyState">
                <div className="flex items-center gap-2 text-label">
                    <Spinner /> Loading runs…
                </div>
                <EmptyState
                    title="No agents yet"
                    description="Create an agent to automate a task."
                />
            </Row>
        </section>
    )
}
