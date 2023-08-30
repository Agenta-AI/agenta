#!/bin/bash

# Given that the `ee/` folder structure always mirrors the `agenta-web/` folder structure,
# we only need to maintain a list of files and folders to sync.

# Define the files and folders to copy in an array.
ITEMS_TO_SYNC=(
    "agenta-web/src/components/Sidebar/Sidebar.tsx"
    "agenta-web/src/config"
    "agenta-web/src/pages/auth"
    "agenta-web/src/_app.tsx"
)

# Copy the items
for ITEM in "${ITEMS_TO_SYNC[@]}"; do
    DEST="ee/${ITEM#agenta-web/}"  # Construct the destination path
    if [ -d "$ITEM" ]; then
        # If item is a directory
        cp -R "$ITEM" "$(dirname "$DEST")"
    else
        # If item is a file
        cp "$ITEM" "$DEST"
    fi
done

# Use provided commit message or default to "ee: update agenta-web"
COMMIT_MSG="${1:-ee: update agenta-web}"

git add ee/ && git commit -m "$COMMIT_MSG"
git push origin private
