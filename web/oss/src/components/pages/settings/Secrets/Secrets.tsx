import dynamic from "next/dynamic"
const SecretProviderTable = dynamic(() => import("./SecretProviderTable"), {ssr: false})

export default function Secrets() {
    return (
        <section className="flex flex-col gap-6">
            <SecretProviderTable type="standard" />
            <SecretProviderTable type="custom" />
        </section>
    )
}
