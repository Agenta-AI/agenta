Agenta is a platform for evaluating LLM-powered applications.

# Installation

Create a .env file in the root directory with the following variables:

```
OPENAI_API_KEY=sk-XXXXXXXXXXXXXXXXXXXXXXXX
```

# Running

```
docker compose up
```

This will start a mongodb instance and the api on port 8000.



You can test the api by running:

```
localhost:8000/docs
```

You can test the mongodb instance by running:

```
localhost:8081
```