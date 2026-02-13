import Image from "next/image"

import GetStarted from "@/oss/components/GetStarted/GetStarted"

export default function GetStartedPage() {
    return (
        <main className="flex flex-col grow h-full overflow-auto">
            <section className="w-[90%] flex items-center justify-between mx-auto mt-12 mb-5">
                <Image
                    src="/assets/Agenta-logo-full-light.png"
                    alt="agenta-ai"
                    width={114}
                    height={39}
                />
            </section>

            <GetStarted />
        </main>
    )
}
