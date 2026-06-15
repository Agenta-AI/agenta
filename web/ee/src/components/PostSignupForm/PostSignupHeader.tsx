import Image from "next/image"

import {useAppTheme} from "@/oss/components/Layout/ThemeContextProvider"
import ListOfOrgs from "@/oss/components/Sidebar/components/ListOfOrgs"
import type {Org} from "@/oss/lib/Types"

interface PostSignupHeaderProps {
    orgs: Org[]
}

/**
 * The header is the only piece of chrome shown on /post-signup. It's hoisted
 * out of the form so we can render it during the loading / fallback states
 * as well — the user always sees the Agenta brand + org selector, never a
 * blank viewport.
 */
const PostSignupHeader = ({orgs}: PostSignupHeaderProps) => {
    const overrideOrgId = orgs.length > 0 ? orgs[0]?.id : undefined
    const {appTheme} = useAppTheme()

    return (
        <section className="w-[90%] flex items-center justify-between mx-auto mt-12 mb-5">
            <Image
                src={
                    appTheme === "dark"
                        ? "/assets/Agenta-logo-full-dark-accent.png"
                        : "/assets/Agenta-logo-full-light.png"
                }
                alt="agenta-ai"
                width={114}
                height={39}
            />

            <ListOfOrgs
                collapsed={false}
                interactive={true}
                orgSelectionEnabled={false}
                buttonProps={{className: "w-[236px] !p-1 !h-10 rounded"}}
                overrideOrgId={overrideOrgId}
            />
        </section>
    )
}

export default PostSignupHeader
