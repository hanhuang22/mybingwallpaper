"""One-time, guarded repair of the 2025-08-12 to 2026-09-29 date offset.

Run without flags for a dry run. --apply requires a verified pre-migration
backup of every OSS month object. --verify compares the result with that backup.
"""

import argparse
from collections import Counter
from datetime import datetime, timedelta
import hashlib
import json
import os
from pathlib import Path


FIRST_SHIFTED = "20250812"
LAST_SHIFTED = "20260929"
EXPECTED_MONTHS = 201
EXPECTED_RECORDS = 6116
EXPECTED_CHANGED_MONTHS = {
    f"{year}{month:02d}"
    for year, months in ((2025, range(8, 13)), (2026, range(1, 10)))
    for month in months
}


def read_months(directory):
    files = sorted(directory.glob("*.json"))
    assert len(files) == EXPECTED_MONTHS, f"Expected {EXPECTED_MONTHS} months, got {len(files)}"
    months = {}
    for path in files:
        data = json.loads(path.read_text(encoding="utf-8"))
        assert all(key.startswith(path.stem) for key in data), path
        months[path.stem] = data
    return months


def flatten(months):
    records = {}
    for data in months.values():
        for key, record in data.items():
            assert key not in records, f"Duplicate key: {key}"
            assert record["date"] == f"{key[:4]}-{key[4:6]}-{key[6:8]}", key
            records[key] = record
    return records


def migrate(original):
    assert len(original) == EXPECTED_RECORDS, len(original)
    assert min(original) == "20100101" and max(original) == LAST_SHIFTED
    assert original["20250811"]["imgurl"] == original[FIRST_SHIFTED]["imgurl"]

    migrated = {}
    dropped = []
    for old_key in sorted(original):
        record = original[old_key].copy()
        if old_key < FIRST_SHIFTED:
            migrated[old_key] = record
            continue

        new_key = (datetime.strptime(old_key, "%Y%m%d") - timedelta(days=1)).strftime("%Y%m%d")
        if new_key in migrated:
            assert old_key == FIRST_SHIFTED and new_key == "20250811"
            assert record["imgurl"] == migrated[new_key]["imgurl"]
            dropped.append(old_key)
            continue

        old_suffix = f"{old_key[:4]}/{old_key[4:6]}/{old_key[6:8]}"
        new_suffix = f"{new_key[:4]}/{new_key[4:6]}/{new_key[6:8]}"
        assert record["imgtitle"].endswith(old_suffix), old_key
        record["imgtitle"] = record["imgtitle"][:-10] + new_suffix
        record["date"] = f"{new_key[:4]}-{new_key[4:6]}-{new_key[6:8]}"
        migrated[new_key] = record

    assert dropped == [FIRST_SHIFTED], dropped
    assert len(migrated) == EXPECTED_RECORDS - 1
    assert max(migrated) == "20260928"
    day = datetime.strptime(min(migrated), "%Y%m%d")
    while day <= datetime.strptime(max(migrated), "%Y%m%d"):
        assert day.strftime("%Y%m%d") in migrated, f"Missing day: {day:%Y-%m-%d}"
        day += timedelta(days=1)
    assert Counter(x["imgurl"] for x in migrated.values()) == (
        Counter(x["imgurl"] for x in original.values()) - Counter([original[FIRST_SHIFTED]["imgurl"]])
    )

    output = {}
    for key, record in sorted(migrated.items()):
        output.setdefault(key[:6], {})[key] = record
    return output, dropped


def verify_backup(backup_dir, current):
    manifest = json.loads((backup_dir / "manifest.json").read_text(encoding="utf-8"))
    assert manifest["object_count"] == EXPECTED_MONTHS
    assert manifest["git_head"] == "da461c49e080ae202440fc9ca8ba5f3a8d9336f3"
    assert len(manifest["objects"]) == EXPECTED_MONTHS
    for item in manifest["objects"]:
        saved = backup_dir / item["key"]
        raw = saved.read_bytes()
        assert hashlib.sha256(raw).hexdigest() == item["sha256"], item["key"]
        month = Path(item["key"]).stem
        assert json.loads(raw.decode("utf-8")) == current[month], item["key"]


def write_changed(month_dir, before, after):
    changed = {month for month in before if before[month] != after[month]}
    assert changed == EXPECTED_CHANGED_MONTHS, sorted(changed)
    pending = []
    for month in sorted(changed):
        path = month_dir / f"{month}.json"
        original = path.read_bytes()
        newline = b"\r\n" if b"\r\n" in original else b"\n"
        payload = json.dumps(after[month], ensure_ascii=False, indent=2).encode("utf-8")
        if newline == b"\r\n":
            payload = payload.replace(b"\n", b"\r\n")
        if original.endswith(newline):
            payload += newline
        temp = path.with_suffix(".json.datefix.tmp")
        temp.write_bytes(payload)
        assert json.loads(temp.read_text(encoding="utf-8")) == after[month]
        pending.append((temp, path))
    for temp, path in pending:
        os.replace(temp, path)
    return changed


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument("--apply", action="store_true")
    mode.add_argument("--verify", action="store_true")
    parser.add_argument("--backup-dir", type=Path)
    args = parser.parse_args()
    root = Path(__file__).resolve().parent
    month_dir = root / "month"

    if args.verify:
        assert args.backup_dir, "--verify requires --backup-dir"
        original = read_months(args.backup_dir / "month")
        verify_backup(args.backup_dir, original)
        expected, dropped = migrate(flatten(original))
        actual = read_months(month_dir)
        assert actual == expected, "Migrated archive differs from the expected output"
        print(f"Verified {len(flatten(actual))} records; removed duplicate {dropped[0]}")
        return

    before = read_months(month_dir)
    if args.apply:
        assert args.backup_dir, "--apply requires --backup-dir"
        verify_backup(args.backup_dir, before)
    after, dropped = migrate(flatten(before))
    changed = {month for month in before if before[month] != after[month]}
    assert changed == EXPECTED_CHANGED_MONTHS, sorted(changed)
    print(f"Dry-run: {len(changed)} months change; {len(flatten(after))} records remain; duplicate {dropped[0]} is removed")
    if args.apply:
        write_changed(month_dir, before, after)
        print("Applied migration to local month files")


if __name__ == "__main__":
    main()
