#!/bin/bash
#
# Quick Agenta Database Queries
#
# Common one-liner queries for rapid database inspection
#

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
QUERY_SCRIPT="$SCRIPT_DIR/agenta-db-query.sh"

# Colors
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

show_menu() {
    echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo -e "${GREEN}  Agenta Quick Queries${NC}"
    echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo
    echo -e "  ${YELLOW}1)${NC}  List all tables (core)"
    echo -e "  ${YELLOW}2)${NC}  List all tables (tracing)"
    echo -e "  ${YELLOW}3)${NC}  List all applications"
    echo -e "  ${YELLOW}4)${NC}  List all users"
    echo -e "  ${YELLOW}5)${NC}  Recent traces (last 10)"
    echo -e "  ${YELLOW}6)${NC}  Count traces by application"
    echo -e "  ${YELLOW}7)${NC}  Database sizes"
    echo -e "  ${YELLOW}8)${NC}  Table sizes"
    echo -e "  ${YELLOW}9)${NC}  Traces in last 24 hours"
    echo -e "  ${YELLOW}10)${NC} Custom query (core)"
    echo -e "  ${YELLOW}11)${NC} Custom query (tracing)"
    echo -e "  ${YELLOW}q)${NC}  Quit"
    echo
    echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo
}

run_query() {
    local db=$1
    local query=$2
    "$QUERY_SCRIPT" "$db" "$query"
    echo
    read -p "Press Enter to continue..."
}

while true; do
    clear
    show_menu
    read -p "Select an option: " choice
    echo

    case $choice in
        1)
            run_query core "\dt"
            ;;
        2)
            run_query tracing "\dt"
            ;;
        3)
            run_query core "SELECT id, app_name, created_at FROM app_db ORDER BY created_at DESC;"
            ;;
        4)
            run_query core "SELECT id, email, username, created_at FROM users ORDER BY created_at DESC;"
            ;;
        5)
            run_query tracing "SELECT tree_id, node_name, created_at, refs->>'application.slug' as app FROM nodes ORDER BY created_at DESC LIMIT 10;"
            ;;
        6)
            run_query tracing "SELECT refs->>'application.slug' as application, COUNT(DISTINCT tree_id) as trace_count FROM nodes WHERE project_id = '019a0cc4-f1a3-7493-8d10-88d0f067bb47' GROUP BY refs->>'application.slug' ORDER BY trace_count DESC;"
            ;;
        7)
            run_query core "SELECT pg_database.datname, pg_size_pretty(pg_database_size(pg_database.datname)) AS size FROM pg_database WHERE datname LIKE 'agenta_%';"
            ;;
        8)
            run_query tracing "SELECT tablename, pg_size_pretty(pg_total_relation_size('public.'||tablename)) AS size FROM pg_tables WHERE schemaname = 'public' ORDER BY pg_total_relation_size('public.'||tablename) DESC;"
            ;;
        9)
            run_query tracing "SELECT tree_id, node_name, created_at, refs->>'application.slug' as app FROM nodes WHERE project_id = '019a0cc4-f1a3-7493-8d10-88d0f067bb47' AND created_at > NOW() - INTERVAL '24 hours' ORDER BY created_at DESC;"
            ;;
        10)
            read -p "Enter SQL query for CORE database: " custom_query
            run_query core "$custom_query"
            ;;
        11)
            read -p "Enter SQL query for TRACING database: " custom_query
            run_query tracing "$custom_query"
            ;;
        q|Q)
            echo "Goodbye!"
            exit 0
            ;;
        *)
            echo "Invalid option. Please try again."
            sleep 2
            ;;
    esac
done
