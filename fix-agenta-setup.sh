#!/usr/bin/env bash
# fix-agenta-setup.sh
# Run from ~/agenta with: bash fix-agenta-setup.sh
set -e
cd "$(git rev-parse --show-toplevel)"
echo "Working directory: $(pwd)"
echo ""

echo "=== Fix 1: Docker daemon DNS ==="
sudo tee /etc/docker/daemon.json > /dev/null <<'EOF'
{
  "ipv6": false,
  "dns": ["8.8.8.8", "8.8.4.4"]
}
EOF
echo "Restarting Docker daemon..."
sudo systemctl restart docker
sleep 3
echo "DNS fix applied ✓"
echo ""

echo "=== Fix 2: web/oss/public ownership ==="
sudo chown -R "$(id -u):$(id -g)" web/oss/public/
echo "Ownership fixed ✓"
ls -la web/oss/public/
echo ""

echo "=== Fix 3: Verify env files ==="
[[ -f "hosting/docker-compose/oss/.env.oss.dev" ]] && echo "✓ .env.oss.dev exists" || echo "✗ .env.oss.dev MISSING"
[[ -f "hosting/docker-compose/oss/.env.oss.gh"  ]] && echo "✓ .env.oss.gh exists"  || echo "✗ .env.oss.gh MISSING"
echo ""

echo "=== All fixes done! Run commands below from $(pwd) ==="
echo ""
echo "Option A — full stack via Docker (dev mode, no web container):"
echo "  bash ./hosting/docker-compose/run.sh --oss --dev --no-web --build \\"
echo "    --env-file hosting/docker-compose/oss/.env.oss.dev"
echo ""
echo "Option B — pre-built images:"
echo "  bash ./hosting/docker-compose/run.sh --oss --gh \\"
echo "    --env-file hosting/docker-compose/oss/.env.oss.gh"
echo ""
echo "Frontend on host (after Option A):"
echo "  cd web && pnpm dev-oss"
