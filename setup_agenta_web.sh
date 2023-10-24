#!/bin/bash

source .env
echo $DOMAIN_NAME

update_env_var() {
    key="$1"
    new_value="$2"
    file="$3"

    # check if the key exists in the file
    if grep -q $key $file; then
        # the key exists, replace the line with new key value pair
        sed -i'' "s#^$key=.*#$key=$new_value#" $file
    else
        # the key does not exist, add to the file
        echo "$key=$new_value" >> $file
    fi
}


# TODO: ensure that when we do the replace the quotes "" are not escaped and are included
update_env_var "NEXT_PUBLIC_AGENTA_API_URL" "${DOMAIN_NAME:=http://localhost}" "./agenta-web/.env"
update_env_var "NEXT_PUBLIC_FF" oss "./agenta-web/.env"

# Copy the .env.local.example to .env.local if it doesn't exist
if ! [ -e ./agenta-web/.env.local ] ; then
    cp ./agenta-web/.env.local.example ./agenta-web/.env.local
fi

# docker-compose -f docker-compose.prod.yml up
