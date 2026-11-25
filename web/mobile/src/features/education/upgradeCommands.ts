import type {UpgradeMethod} from "@agenta/navigation"

/**
 * The standard upgrade commands of an open source install, by deployment method, for the
 * version `latest`. Each comes from the self-hosting docs: the quick start and the upgrade guide
 * for Compose and Helm, the Railway guide for Railway. `git pull` comes first because a release
 * can change the compose file or the chart, and both live in the clone.
 *
 * `cloneComment` is the first line, already in the reader's language.
 */
export const upgradeCommands = (
    method: UpgradeMethod,
    latest: string,
    cloneComment: string,
): string => {
    switch (method) {
        case "compose":
            return [
                `# ${cloneComment}`,
                "git pull",
                "docker compose -f hosting/docker-compose/oss/docker-compose.gh.yml \\",
                "  --env-file hosting/docker-compose/oss/.env.oss.gh \\",
                "  --profile with-web --profile with-traefik up -d --pull always",
            ].join("\n")
        case "helm":
            return [
                `# ${cloneComment}`,
                "git pull",
                "helm upgrade agenta hosting/kubernetes/helm \\",
                "  --namespace agenta \\",
                "  -f hosting/kubernetes/oss/.values.oss.yaml",
                "kubectl -n agenta get jobs -l app.kubernetes.io/component=alembic",
            ].join("\n")
        case "railway":
            return [
                `# ${cloneComment}`,
                'export RAILWAY_PROJECT_NAME="agenta-oss"',
                'export RAILWAY_ENVIRONMENT_NAME="production"',
                `export AGENTA_API_IMAGE="ghcr.io/agenta-ai/agenta-api:${latest}"`,
                `export AGENTA_WEB_IMAGE="ghcr.io/agenta-ai/agenta-web:${latest}"`,
                `export AGENTA_WEB_MOBILE_IMAGE="ghcr.io/agenta-ai/agenta-web-mobile:${latest}"`,
                `export AGENTA_SERVICES_IMAGE="ghcr.io/agenta-ai/agenta-services:${latest}"`,
                `export AGENTA_RUNNER_IMAGE="ghcr.io/agenta-ai/agenta-runner:${latest}"`,
                "./hosting/railway/oss/scripts/deploy-from-images.sh",
            ].join("\n")
    }
}
