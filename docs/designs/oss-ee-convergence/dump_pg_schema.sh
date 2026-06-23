#!/usr/bin/env bash
#
# Dump every table definition of a Postgres database in a deterministic,
# diff-friendly text format. Run it once against an OSS db and once against an
# EE db, then `diff` (or `diff --side-by-side`) the two outputs.
#
# Covers: extensions, enum types, sequences, tables (columns with exact types,
# nullability, defaults, identity), column order, all constraints (PK/FK/UNIQUE/
# CHECK/EXCLUDE), indexes, triggers, views, materialized views, and the alembic
# revision head. Optionally exact row counts (-c) to spot dead/legacy tables.
#
# Usage:
#   ./dump_pg_schema.sh -U <user> -d <database> [-W <password>] [-H <host>] [-p <port>] [-c] [-o <outfile>]
#
# Examples:
#   ./dump_pg_schema.sh -U username -W password -d agenta_oss_core -o oss_core.txt -p 5430
#   ./dump_pg_schema.sh -U username -W password -d agenta_ee_core  -o ee_core.txt -p 5431
#   diff oss_core.txt ee_core.txt > diff_core.txt
#
#   ./dump_pg_schema.sh -U username -W password -d agenta_oss_core -o oss_tracing.txt -p 5430
#   ./dump_pg_schema.sh -U username -W password -d agenta_ee_core  -o ee_tracing.txt -p 5431
#   diff oss_tracing.txt ee_tracing.txt > diff_tracing.txt
#
# Password can also come from PGPASSWORD or ~/.pgpass; -W just sets PGPASSWORD.

set -euo pipefail

HOST="localhost"
PORT="5432"
DBUSER=""
DB=""
OUT=""
COUNTS=0

usage() {
    grep '^#' "$0" | head -20 | sed 's/^# \{0,1\}//'
    exit 1
}

while getopts "H:p:U:d:W:o:ch" opt; do
    case "$opt" in
        H) HOST="$OPTARG" ;;
        p) PORT="$OPTARG" ;;
        U) DBUSER="$OPTARG" ;;
        d) DB="$OPTARG" ;;
        W) export PGPASSWORD="$OPTARG" ;;
        o) OUT="$OPTARG" ;;
        c) COUNTS=1 ;;
        h|*) usage ;;
    esac
done

[[ -z "$DBUSER" || -z "$DB" ]] && usage

PSQL=(psql -X -q -A -t -v ON_ERROR_STOP=1 -h "$HOST" -p "$PORT" -U "$DBUSER" -d "$DB")

run() {
    "${PSQL[@]}" -c "$1"
}

dump() {
    echo "################################################################"
    echo "## SCHEMA DUMP — database: $DB"
    echo "################################################################"
    run "SELECT 'server: ' || current_setting('server_version')"
    echo

    echo "## EXTENSIONS"
    run "SELECT 'EXTENSION ' || extname || ' ' || extversion
         FROM pg_extension ORDER BY extname"
    echo

    echo "## ENUM TYPES"
    run "SELECT 'ENUM ' || n.nspname || '.' || t.typname || ' = ('
                || string_agg(e.enumlabel, ', ' ORDER BY e.enumsortorder) || ')'
         FROM pg_type t
         JOIN pg_enum e ON e.enumtypid = t.oid
         JOIN pg_namespace n ON n.oid = t.typnamespace
         GROUP BY n.nspname, t.typname
         ORDER BY 1"
    echo

    echo "## SEQUENCES"
    run "SELECT 'SEQUENCE ' || schemaname || '.' || sequencename
                || ' AS ' || data_type
                || ' START ' || start_value || ' INCREMENT ' || increment_by
         FROM pg_sequences
         WHERE schemaname NOT IN ('pg_catalog', 'information_schema')
         ORDER BY 1"
    echo

    echo "## COLUMNS (sorted by name; see COLUMN-ORDER for physical order)"
    run "SELECT 'TABLE ' || n.nspname || '.' || c.relname || ' COLUMN ' || a.attname
                || ' ' || format_type(a.atttypid, a.atttypmod)
                || CASE WHEN a.attnotnull THEN ' NOT NULL' ELSE '' END
                || COALESCE(' DEFAULT ' || pg_get_expr(d.adbin, d.adrelid), '')
                || CASE WHEN a.attidentity <> '' THEN ' IDENTITY' ELSE '' END
                || CASE WHEN a.attgenerated <> '' THEN ' GENERATED' ELSE '' END
         FROM pg_class c
         JOIN pg_namespace n ON n.oid = c.relnamespace
         JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum > 0 AND NOT a.attisdropped
         LEFT JOIN pg_attrdef d ON d.adrelid = c.oid AND d.adnum = a.attnum
         WHERE c.relkind IN ('r', 'p')
           AND n.nspname NOT IN ('pg_catalog', 'information_schema')
         ORDER BY 1"
    echo

    echo "## COLUMN ORDER"
    run "SELECT 'TABLE ' || n.nspname || '.' || c.relname || ' COLUMN-ORDER ('
                || string_agg(a.attname, ', ' ORDER BY a.attnum) || ')'
         FROM pg_class c
         JOIN pg_namespace n ON n.oid = c.relnamespace
         JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum > 0 AND NOT a.attisdropped
         WHERE c.relkind IN ('r', 'p')
           AND n.nspname NOT IN ('pg_catalog', 'information_schema')
         GROUP BY n.nspname, c.relname
         ORDER BY 1"
    echo

    echo "## CONSTRAINTS (PK / FK / UNIQUE / CHECK / EXCLUDE)"
    run "SELECT 'TABLE ' || n.nspname || '.' || c.relname
                || ' CONSTRAINT ' || con.conname || ' ' || pg_get_constraintdef(con.oid)
         FROM pg_constraint con
         JOIN pg_class c ON c.oid = con.conrelid
         JOIN pg_namespace n ON n.oid = c.relnamespace
         WHERE n.nspname NOT IN ('pg_catalog', 'information_schema')
         ORDER BY 1"
    echo

    echo "## INDEXES"
    run "SELECT 'TABLE ' || schemaname || '.' || tablename
                || ' INDEX ' || indexname || ' '
                || regexp_replace(indexdef, '\s+', ' ', 'g')
         FROM pg_indexes
         WHERE schemaname NOT IN ('pg_catalog', 'information_schema')
         ORDER BY 1"
    echo

    echo "## TRIGGERS"
    run "SELECT 'TABLE ' || n.nspname || '.' || c.relname
                || ' TRIGGER ' || t.tgname || ' '
                || regexp_replace(pg_get_triggerdef(t.oid), '\s+', ' ', 'g')
         FROM pg_trigger t
         JOIN pg_class c ON c.oid = t.tgrelid
         JOIN pg_namespace n ON n.oid = c.relnamespace
         WHERE NOT t.tgisinternal
           AND n.nspname NOT IN ('pg_catalog', 'information_schema')
         ORDER BY 1"
    echo

    echo "## VIEWS"
    run "SELECT 'VIEW ' || schemaname || '.' || viewname || ' = '
                || regexp_replace(definition, '\s+', ' ', 'g')
         FROM pg_views
         WHERE schemaname NOT IN ('pg_catalog', 'information_schema')
         ORDER BY 1"
    run "SELECT 'MATVIEW ' || schemaname || '.' || matviewname || ' = '
                || regexp_replace(definition, '\s+', ' ', 'g')
         FROM pg_matviews
         WHERE schemaname NOT IN ('pg_catalog', 'information_schema')
         ORDER BY 1"
    echo

    echo "## ALEMBIC"
    # Post-split there can be up to three version tables: the parked legacy
    # chain (alembic_version), the shared chain (alembic_version_oss), and the
    # EE-only chain (alembic_version_ee). Print whichever exist.
    local vt VT
    for vt in alembic_version alembic_version_oss alembic_version_ee; do
        VT=$(printf '%s' "$vt" | tr '[:lower:]' '[:upper:]')
        if [[ "$(run "SELECT to_regclass('public.${vt}') IS NOT NULL")" == "t" ]]; then
            run "SELECT '${VT} ' || version_num FROM ${vt} ORDER BY 1"
        else
            echo "${VT} (absent)"
        fi
    done
    echo

    if [[ "$COUNTS" == "1" ]]; then
        echo "## ROW COUNTS (exact)"
        run "SELECT format('SELECT ''TABLE %I.%I ROWS '' || count(*) FROM %I.%I;',
                           n.nspname, c.relname, n.nspname, c.relname)
             FROM pg_class c
             JOIN pg_namespace n ON n.oid = c.relnamespace
             WHERE c.relkind = 'r'
               AND n.nspname NOT IN ('pg_catalog', 'information_schema')
             ORDER BY n.nspname, c.relname" | "${PSQL[@]}"
        echo
    fi
}

if [[ -n "$OUT" ]]; then
    dump > "$OUT"
    echo "wrote $OUT" >&2
else
    dump
fi
