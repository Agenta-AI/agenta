```bash
docker ps 
docker exec -it {backend-container-id} bash
cd /app/agenta_backend/migrations/mongo_to_postgres
python3 migration.py
```