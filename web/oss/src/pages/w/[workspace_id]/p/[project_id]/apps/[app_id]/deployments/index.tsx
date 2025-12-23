import {GetServerSideProps} from "next/dist/types"

export const getServerSideProps: GetServerSideProps = async ({params}) => {
    const workspaceId = params?.workspace_id
    const projectId = params?.project_id
    const appId = params?.app_id

    if (!workspaceId || !projectId || !appId) {
        return {
            notFound: true,
        }
    }

    return {
        redirect: {
            destination: `/w/${workspaceId}/p/${projectId}/apps/${appId}/variants?tab=deployments`,
            permanent: true,
        },
    }
}

const DeploymentsRedirectPage = () => null

export default DeploymentsRedirectPage
