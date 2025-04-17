import requests
from pathlib import Path

API_URL = "http://localhost:80/api/testsets/upload"
API_KEY = "ApiKey xxx.xxx"  # Replace with your actual key
TESTSET_DIR = Path("testsets")
FILES = [
    ("testset_1000.json", "testset_1000_json"),
    ("testset_1001.json", "testset_1001_json"),
    ("testset_1mb_minus.json", "testset_1mb_json_minus"),
    ("testset_1mb_plus.json", "testset_1mb_json_plus"),
    ("testset_1000.csv", "testset_1000_csv"),
    ("testset_1001.csv", "testset_1001_csv"),
    ("testset_1mb_minus.csv", "testset_1mb_csv_minus"),
    ("testset_1mb_plus.csv", "testset_1mb_csv_plus"),
]

for file_name, testset_name in FILES:
    file_path = TESTSET_DIR / file_name
    print(f"Uploading: {file_path.name}")
    with open(file_path, "rb") as file:
        files = {"file": file}
        data = {
            "testset_name": testset_name,
            "upload_type": "JSON" if file_path.suffix == ".json" else "CSV",
        }
        response = requests.post(
            API_URL, files=files, data=data, headers={"Authorization": API_KEY}
        )
    print(f"{file_path.name} → {response.status_code}")
    try:
        print(response.json())
    except Exception:
        print(response.text)
    print("-" * 60)
