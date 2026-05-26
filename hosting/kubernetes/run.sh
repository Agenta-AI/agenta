#!/bin/bash
set -euo pipefail

LICENSE="oss"
RELEASE="agenta"
NAMESPACE="agenta"
CHART="./hosting/kubernetes/helm"
WAIT=false
TIMEOUT="10m"
DRY_RUN=false
NUKE=false
VALUES_FILES=()
EXTRA_SET_ARGS=()

show_usage() {
    echo "Usage: $0 [OPTIONS]"
    echo ""
    echo "Edition:"
    echo "  --oss                   Use .values.oss.yaml when present (default)"
    echo "  --ee                    Use .values.ee.yaml when present"
    echo "  --license <oss|ee>      Set edition explicitly"
    echo ""
    echo "Kubernetes:"
    echo "  --release <name>        Helm release name (default: agenta)"
    echo "  --namespace <name>      Kubernetes namespace (default: agenta)"
    echo "  -f, --values <path>     Values file; can be repeated"
    echo "  --set <key=value>       Additional Helm --set value; can be repeated"
    echo "  --wait                  Wait for resources to become ready"
    echo "  --timeout <duration>    Helm timeout when --wait is used (default: 10m)"
    echo "  --dry-run               Render manifests without contacting the cluster"
    echo "  --nuke                  Uninstall the release and delete its PVCs and kept Secrets before install"
    echo ""
    echo "Examples:"
    echo "  cp hosting/kubernetes/oss/values.oss.example.yaml hosting/kubernetes/oss/.values.oss.yaml"
    echo "  $0 --oss --wait"
    echo "  cp hosting/kubernetes/ee/values.ee.example.yaml hosting/kubernetes/ee/.values.ee.yaml"
    echo "  $0 --ee --wait"
    exit 0
}

error_exit() {
    echo "Error: $1" >&2
    exit 1
}

require_command() {
    command -v "$1" >/dev/null 2>&1 || error_exit "$1 is required but was not found in PATH."
}

while [[ "$#" -gt 0 ]]; do
    case "$1" in
        --oss)
            LICENSE="oss"
            ;;
        --ee)
            LICENSE="ee"
            ;;
        --license)
            [[ -n "${2:-}" ]] || error_exit "Missing value for --license."
            [[ "$2" == "oss" || "$2" == "ee" ]] || error_exit "Invalid license: $2. Allowed: oss, ee."
            LICENSE="$2"
            shift
            ;;
        --release)
            [[ -n "${2:-}" ]] || error_exit "Missing value for --release."
            RELEASE="$2"
            shift
            ;;
        --namespace)
            [[ -n "${2:-}" ]] || error_exit "Missing value for --namespace."
            NAMESPACE="$2"
            shift
            ;;
        -f|--values)
            [[ -n "${2:-}" ]] || error_exit "Missing value for --values."
            VALUES_FILES+=("$2")
            shift
            ;;
        --set)
            [[ -n "${2:-}" ]] || error_exit "Missing value for --set."
            EXTRA_SET_ARGS+=(--set "$2")
            shift
            ;;
        --wait)
            WAIT=true
            ;;
        --timeout)
            [[ -n "${2:-}" ]] || error_exit "Missing value for --timeout."
            TIMEOUT="$2"
            shift
            ;;
        --dry-run)
            DRY_RUN=true
            ;;
        --nuke)
            NUKE=true
            ;;
        --help)
            show_usage
            ;;
        *)
            error_exit "Unknown parameter: $1. Use --help for usage."
            ;;
    esac
    shift
done

require_command helm
if [[ "$NUKE" == "true" ]]; then
    require_command kubectl
fi

if [[ "$NUKE" == "true" ]]; then
    if [[ "$DRY_RUN" == "true" ]]; then
        error_exit "--nuke cannot be combined with --dry-run."
    fi
    echo "Nuking release '$RELEASE' in namespace '$NAMESPACE'..."
    if helm status "$RELEASE" --namespace "$NAMESPACE" >/dev/null 2>&1; then
        helm uninstall "$RELEASE" --namespace "$NAMESPACE" --ignore-not-found
    else
        echo "  (release not installed; skipping helm uninstall)"
    fi
    # PVCs and Secrets with helm.sh/resource-policy: keep survive uninstall.
    # Use the standard instance label to clean up everything the chart owns.
    # Guard the deletes: --ignore-not-found doesn't suppress "namespace not found",
    # so skip them entirely if the namespace doesn't exist (idempotent --nuke).
    if kubectl get namespace "$NAMESPACE" >/dev/null 2>&1; then
        kubectl -n "$NAMESPACE" delete pvc \
            -l "app.kubernetes.io/instance=$RELEASE" \
            --ignore-not-found
        kubectl -n "$NAMESPACE" delete secret \
            -l "app.kubernetes.io/instance=$RELEASE" \
            --ignore-not-found
    fi
    echo "✅ Release '$RELEASE' nuked. Proceeding with fresh install..."
fi

EDITION_VALUES="./hosting/kubernetes/${LICENSE}/.values.${LICENSE}.yaml"

[[ -d "$CHART" ]] || error_exit "Helm chart not found: $CHART. Run this script from the repository root."
if ((${#VALUES_FILES[@]})); then
    for values_file in "${VALUES_FILES[@]}"; do
        [[ -f "$values_file" ]] || error_exit "Values file not found: $values_file."
    done
elif [[ -f "$EDITION_VALUES" ]]; then
    VALUES_FILES+=("$EDITION_VALUES")
fi

if [[ "$DRY_RUN" == "true" ]]; then
    HELM_CMD=(helm template "$RELEASE" "$CHART" --namespace "$NAMESPACE")
else
    HELM_CMD=(helm upgrade "$RELEASE" "$CHART" --install --namespace "$NAMESPACE" --create-namespace)
    if helm status "$RELEASE" --namespace "$NAMESPACE" >/dev/null 2>&1; then
        # Detect existing license to prevent silent OSS<->EE flip on re-install.
        # Use `helm get values -o yaml` + awk so the script doesn't depend on python3 or jq.
        # Reads two shapes:
        #   v0.100.3+   agenta.license: oss|ee
        #   pre-v0.100.3 (compat layer)  global.agentaLicense: oss|ee
        EXISTING_VALUES=$(helm get values "$RELEASE" --namespace "$NAMESPACE" -o yaml 2>/dev/null || true)
        EXISTING_LICENSE=$(printf '%s\n' "$EXISTING_VALUES" \
            | awk '/^agenta:/{a=1; next} a && /^[^[:space:]]/{a=0} a && /^[[:space:]]+license:/{print $2; exit}' \
            | tr -d '"'"'"'')
        if [[ -z "$EXISTING_LICENSE" ]]; then
            EXISTING_LICENSE=$(printf '%s\n' "$EXISTING_VALUES" \
                | awk '/^global:/{a=1; next} a && /^[^[:space:]]/{a=0} a && /^[[:space:]]+agentaLicense:/{print $2; exit}' \
                | tr -d '"'"'"'')
        fi
        if [[ -n "$EXISTING_LICENSE" && "$EXISTING_LICENSE" != "$LICENSE" ]]; then
            error_exit "Release '$RELEASE' was installed as '$EXISTING_LICENSE'; refusing to switch to '$LICENSE'. Use --nuke to reinstall or pass --license $EXISTING_LICENSE."
        fi
        HELM_CMD+=(--reuse-values)
    fi
fi

if ((${#VALUES_FILES[@]})); then
    for values_file in "${VALUES_FILES[@]}"; do
        HELM_CMD+=(-f "$values_file")
    done
fi

HELM_CMD+=(--set "agenta.license=$LICENSE")

if ((${#EXTRA_SET_ARGS[@]})); then
    HELM_CMD+=("${EXTRA_SET_ARGS[@]}")
fi

if [[ "$WAIT" == "true" && "$DRY_RUN" == "false" ]]; then
    HELM_CMD+=(--wait --timeout "$TIMEOUT")
fi

echo "Running: ${HELM_CMD[*]}"
"${HELM_CMD[@]}"

if [[ "$DRY_RUN" == "false" ]]; then
    echo "Helm release '$RELEASE' applied in namespace '$NAMESPACE'."
    echo "Check rollout:"
    echo "  kubectl -n $NAMESPACE get pods"
    echo "  kubectl -n $NAMESPACE get jobs"
fi
