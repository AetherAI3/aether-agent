import json
import sys

line = sys.stdin.readline()
task = json.loads(line)
assert task["type"] == "task"
print(json.dumps({"type": "stage", "name": "dogfood", "face": ""}), flush=True)
print(json.dumps({"type": "done", "ok": True, "result": "local child complete", "remaining": 0, "reason": ""}), flush=True)
