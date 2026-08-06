import json
import csv
import random
import string
from pathlib import Path


def generate_testcase(large=False):
    return {
        "country": "".join(
            random.choices(string.ascii_letters + string.digits, k=512 if large else 8)
        ),
        "correct_answer": "".join(
            random.choices(string.ascii_letters + string.digits, k=512 if large else 8)
        ),
    }


# Generate 1000 and 1001 testcases
testset_1000 = [generate_testcase() for _ in range(1000)]
testset_1001 = [generate_testcase() for _ in range(1001)]


# Generate ~1MB and ~1MB+10B testsets
def generate_testset_to_size(target_size_bytes):
    testset = []
    size = 2  # for opening and closing brackets []
    while size < target_size_bytes:
        row = generate_testcase(large=True)
        row_json = json.dumps(row)
        row_size = len(row_json.encode("utf-8")) + (1 if testset else 0)
        if size + row_size > target_size_bytes:
            break
        testset.append(row)
        size += row_size
    return testset


# Generate ~1MB and ~1MB+ testsets
testset_1mb_minus = generate_testset_to_size(1_048_000)

# Copy it and add two more rows to overflow the limit
testset_1mb_plus = testset_1mb_minus.copy()
testset_1mb_bis = testset_1mb_minus.copy()
testset_1mb_plus.extend(testset_1mb_bis[:2])

# Ensure output directory exists
Path("testsets").mkdir(exist_ok=True)


# Helper to write CSV
def write_csv(filename, data):
    with open(filename, "w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=["country", "correct_answer"])
        writer.writeheader()
        writer.writerows(data)


# Save to JSON files
with open("testsets/testset_1000.json", "w") as f:
    json.dump(testset_1000, f)

with open("testsets/testset_1001.json", "w") as f:
    json.dump(testset_1001, f)

with open("testsets/testset_1mb_minus.json", "w") as f:
    json.dump(testset_1mb_minus, f)

with open("testsets/testset_1mb_plus.json", "w") as f:
    json.dump(testset_1mb_plus, f)

# Save to CSV files
write_csv("testsets/testset_1000.csv", testset_1000)
write_csv("testsets/testset_1001.csv", testset_1001)
write_csv("testsets/testset_1mb_minus.csv", testset_1mb_minus)
write_csv("testsets/testset_1mb_plus.csv", testset_1mb_plus)


# Print summary
print(
    {
        "testset_1000_count": len(testset_1000),
        "testset_1001_count": len(testset_1001),
        "testset_1mb_count": len(testset_1mb_minus),
        "testset_1mb_plus_count": len(testset_1mb_plus),
        "testset_1mb_size": sum(
            len(json.dumps(row).encode("utf-8")) + 2 for row in testset_1mb_minus
        ),
        "testset_1mb_plus_size": sum(
            len(json.dumps(row).encode("utf-8")) + 2 for row in testset_1mb_plus
        ),
    }
)
