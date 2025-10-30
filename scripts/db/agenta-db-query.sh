#!/bin/bash
#
# Agenta Database Query Script
#
# Usage:
#   ./agenta-db-query.sh core "SELECT * FROM app_db LIMIT 5;"
#   ./agenta-db-query.sh tracing "SELECT COUNT(*) FROM nodes;"
#   cat my-query.sql | ./agenta-db-query.sh core
#
# Databases:
#   - core: Application data (apps, users, etc)
#   - tracing: Observability data (traces, spans, nodes)
#   - supertokens: Authentication data
#

set -euo pipefail

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Configuration
SSH_HOST="root@91.98.229.196"
DOCKER_COMPOSE_DIR="/opt/agenta/hosting/docker-compose/oss"
DOCKER_COMPOSE_FILE="docker-compose.gh.ssl.yml"
POSTGRES_USER="agenta_user_1ba90dd43950"

# Function to print usage
usage() {
    cat << EOF
${GREEN}Agenta Database Query Script${NC}

${YELLOW}Usage:${NC}
  ./agenta-db-query.sh <database> "<sql-query>"
  cat query.sql | ./agenta-db-query.sh <database>

${YELLOW}Databases:${NC}
  core        - Application data (apps, users, projects)
  tracing     - Observability data (traces, spans, nodes)
  supertokens - Authentication data

${YELLOW}Examples:${NC}
  # Query apps
  ./agenta-db-query.sh core "SELECT app_name FROM app_db;"

  # Count traces
  ./agenta-db-query.sh tracing "SELECT COUNT(*) FROM nodes;"

  # Pipe query from file
  cat my-query.sql | ./agenta-db-query.sh core

  # List all tables
  ./agenta-db-query.sh core "\\dt"

EOF
    exit 1
}

# Check arguments
if [ $# -lt 1 ]; then
    usage
fi

DATABASE_KEY="$1"

# Set database name based on key
case "$DATABASE_KEY" in
    core)
        DATABASE_NAME="agenta_oss_core"
        ;;
    tracing)
        DATABASE_NAME="agenta_oss_tracing"
        ;;
    supertokens)
        DATABASE_NAME="agenta_oss_supertokens"
        ;;
    *)
        echo -e "${RED}Error: Invalid database '$DATABASE_KEY'${NC}" >&2
        echo -e "${YELLOW}Valid databases: core, tracing, supertokens${NC}" >&2
        exit 1
        ;;
esac

# Get SQL query from argument or stdin
if [ $# -ge 2 ]; then
    SQL_QUERY="$2"
else
    # Read from stdin
    SQL_QUERY=$(cat)
fi

# Check if query is empty
if [ -z "$SQL_QUERY" ]; then
    echo -e "${RED}Error: No SQL query provided${NC}" >&2
    usage
fi

# Print header
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${GREEN}Database:${NC} $DATABASE_NAME"
echo -e "${GREEN}Query:${NC}"
echo "$SQL_QUERY"
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo

# Execute query
ssh "$SSH_HOST" "cd $DOCKER_COMPOSE_DIR && docker compose -f $DOCKER_COMPOSE_FILE exec -T postgres psql -U $POSTGRES_USER -d $DATABASE_NAME -c \"$SQL_QUERY\""

RESULT=$?

echo
if [ $RESULT -eq 0 ]; then
    echo -e "${GREEN}✓ Query executed successfully${NC}"
else
    echo -e "${RED}✗ Query failed with exit code $RESULT${NC}"
fi

exit $RESULT
