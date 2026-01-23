import Image from "next/image"

import GetStarted from "@/oss/components/GetStarted/GetStarted"
import ListOfOrgs from "@/oss/components/Sidebar/components/ListOfOrgs"
import {useOrgData} from "@/oss/state/org"

export default function GetStartedPage() {
    const {orgs} = useOrgData()

    return (
        <main className="flex flex-col grow h-full overflow-auto">
            <section className="w-[90%] flex items-center justify-between mx-auto mt-12 mb-5">
                <Image
                    src="/assets/Agenta-logo-full-light.png"
                    alt="agenta-ai"
                    width={114}
                    height={40}
                />

                <ListOfOrgs
                    collapsed={false}
                    interactive={true}
                    orgSelectionEnabled={false}
                    buttonProps={{className: "w-[186px] !p-1 !h-10 rounded"}}
                    overrideOrgId={orgs && orgs.length > 0 ? orgs[0]?.id : undefined}
                />
            </section>

            <GetStarted />
        </main>
    )
}
