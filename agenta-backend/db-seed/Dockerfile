FROM mongo:5.0

COPY evaluators.json /evaluators.json
CMD mongoimport --host mongo --username username --password password --authenticationDatabase admin --db agenta_v2 --collection evaluators --type json --file /evaluators.json --jsonArray