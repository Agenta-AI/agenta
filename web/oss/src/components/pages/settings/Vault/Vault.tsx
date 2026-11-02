import dynamic from "next/dynamic"

const NamedSecretTable = dynamic(() => import("./NamedSecretTable"), {ssr: false})

export default function Vault() {
    return (
        <section className="flex flex-col gap-8">
            <NamedSecretTable />
        </section>
    )
}
