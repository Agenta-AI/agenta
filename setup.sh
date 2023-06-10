#!/bin/bash
source .env
echo $DOMAIN_NAME
echo $AGENTA_API_URL

update_env_var() {
    key="$1"
    new_value="$2"
    file="$3"

    # check if the key exists in the file
    if grep -q $key $file; then
        # the key exists, replace the line with new key value pair
        sed -i '' "s/^$key=.*/$key=$new_value/" $file
    else
        # the key does not exist, add to the file
        echo "$key=$new_value" >> $file
    fi
}

agenta_api_url_env_var_name="NEXT_PUBLIC_AGENTA_API_URL"
agenta_api_url_env_var_value=$AGENTA_API_URL
agenta_web_env_file_path="agenta-web/.env.development.local"