import {ArrowRightOutlined, PlusOutlined} from "@ant-design/icons"
import {Button, Drawer, Typography} from "antd"
import {useAtomValue} from "jotai"
import Link from "next/link"
import {useRouter} from "next/router"
import {useState} from "react"

import {ProviderForm} from "@/features/providers/ProviderForm"
import {ProviderList} from "@/features/providers/ProviderList"
import {providersQueryAtom} from "@/lib/state/providers"

export default function ProvidersPage() {
    const router = useRouter()
    const providers = useAtomValue(providersQueryAtom)
    const firstRun = router.query.first_run === "1"
    const configured = providers.data?.some((provider) => provider.configured) ?? false
    const [open, setOpen] = useState(firstRun || !configured)

    return (
        <section className="page-section narrow-page">
            <header className="page-header">
                <div>
                    <Typography.Text className="eyebrow">PRIVATE BY DEFAULT</Typography.Text>
                    <Typography.Title>Model providers</Typography.Title>
                    <Typography.Paragraph type="secondary">
                        Credentials are stored by the local service and are never shown again.
                    </Typography.Paragraph>
                </div>
                <Button type="primary" icon={<PlusOutlined />} onClick={() => setOpen(true)}>
                    Connect provider
                </Button>
            </header>
            {firstRun && !configured ? (
                <div className="first-run-callout">
                    <span>1</span>
                    <div>
                        <strong>Start here</strong>
                        <p>Connect a provider before creating your first agent.</p>
                    </div>
                </div>
            ) : null}
            <div className="surface-card">
                <ProviderList />
            </div>
            {configured ? (
                <div className="next-step">
                    <span>Provider ready</span>
                    <Link href="/agents/">
                        Create an agent <ArrowRightOutlined />
                    </Link>
                </div>
            ) : null}
            <Drawer
                title="Provider setup"
                width={480}
                open={open}
                destroyOnHidden
                onClose={() => setOpen(false)}
            >
                <ProviderForm onSaved={() => setOpen(false)} />
            </Drawer>
        </section>
    )
}
