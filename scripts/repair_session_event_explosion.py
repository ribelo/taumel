#!/usr/bin/env python3
"""Find and repair Pi sessions bloated by taumel.agents.v4 snapshots.

By default this only scans. Pass --apply to keep the newest registry snapshot,
remove older snapshots, and reconnect the Pi session tree around removed nodes.
Each changed file gets a gzip backup beside it before the atomic replacement.
"""

from __future__ import annotations

import argparse
import gzip
import json
import os
import shutil
import sys
import tempfile
from dataclasses import dataclass, field
from pathlib import Path


CUSTOM_TYPE = "taumel.agents.v4"
REFERENCE_FIELDS = ("firstKeptEntryId", "fromId", "targetId")


@dataclass
class Scan:
    path: Path
    size: int
    lines: int = 0
    snapshots: list[str] = field(default_factory=list)
    parents: dict[str, str | None] = field(default_factory=dict)
    protected_ids: set[str] = field(default_factory=set)
    errors: list[str] = field(default_factory=list)

    @property
    def repairable(self) -> bool:
        return bool(self.obsolete_snapshots) and not self.errors

    @property
    def obsolete_snapshots(self) -> set[str]:
        return set(self.snapshots[:-1]) - self.protected_ids


def scan_file(path: Path) -> Scan:
    result = Scan(path=path, size=path.stat().st_size)
    header_seen = False

    with path.open("rb") as source:
        for line_number, raw in enumerate(source, 1):
            result.lines = line_number
            try:
                entry = json.loads(raw)
            except (json.JSONDecodeError, UnicodeDecodeError) as error:
                result.errors.append(f"line {line_number}: invalid JSON ({error})")
                continue

            if line_number == 1:
                header_seen = entry.get("type") == "session" and isinstance(entry.get("id"), str)
                if not header_seen:
                    result.errors.append("line 1: missing valid session header")
            elif entry.get("type") == "session":
                result.errors.append(f"line {line_number}: duplicate session header")

            entry_id = entry.get("id")
            if entry.get("type") != "session":
                if not isinstance(entry_id, str) or not entry_id:
                    result.errors.append(f"line {line_number}: entry has no valid id")
                    continue
                if entry_id in result.parents:
                    result.errors.append(f"line {line_number}: duplicate id {entry_id}")
                result.parents[entry_id] = entry.get("parentId")

            if entry.get("type") == "custom" and entry.get("customType") == CUSTOM_TYPE:
                if isinstance(entry_id, str):
                    result.snapshots.append(entry_id)

            for field_name in REFERENCE_FIELDS:
                value = entry.get(field_name)
                if isinstance(value, str):
                    result.protected_ids.add(value)

    if not header_seen and result.lines == 0:
        result.errors.append("empty file")

    known_ids = set(result.parents)
    for entry_id, parent_id in result.parents.items():
        if parent_id is not None and parent_id not in known_ids:
            result.errors.append(f"entry {entry_id}: missing parent {parent_id}")
            if len(result.errors) >= 20:
                result.errors.append("additional errors omitted")
                break

    return result


def resolve_parent(parent_id: str | None, removed: dict[str, str | None]) -> str | None:
    seen: set[str] = set()
    while parent_id in removed:
        if parent_id in seen:
            raise ValueError(f"cycle while resolving removed parent {parent_id}")
        seen.add(parent_id)
        parent_id = removed[parent_id]
    return parent_id


def gzip_backup(path: Path) -> Path:
    backup = path.with_name(path.name + ".pre-event-repair.gz")
    if backup.exists():
        raise FileExistsError(f"backup already exists: {backup}")
    temporary = backup.with_name(backup.name + ".tmp")
    try:
        with path.open("rb") as source, gzip.open(temporary, "wb", compresslevel=1) as target:
            shutil.copyfileobj(source, target, length=1024 * 1024)
        os.replace(temporary, backup)
    finally:
        temporary.unlink(missing_ok=True)
    return backup


def repair(scan: Scan) -> tuple[int, int, Path]:
    keep = scan.snapshots[-1]
    removable = scan.obsolete_snapshots
    removed = {entry_id: scan.parents[entry_id] for entry_id in removable}
    backup = gzip_backup(scan.path)
    old_mode = scan.path.stat().st_mode
    fd, temporary_name = tempfile.mkstemp(prefix=scan.path.name + ".", suffix=".tmp", dir=scan.path.parent)
    temporary = Path(temporary_name)
    removed_count = 0

    try:
        with os.fdopen(fd, "wb") as target, scan.path.open("rb") as source:
            for raw in source:
                entry = json.loads(raw)
                entry_id = entry.get("id")
                if entry_id in removable:
                    removed_count += 1
                    continue

                parent_id = entry.get("parentId")
                resolved = resolve_parent(parent_id, removed)
                if resolved != parent_id:
                    entry["parentId"] = resolved
                    raw = (json.dumps(entry, ensure_ascii=False, separators=(",", ":")) + "\n").encode()
                target.write(raw)
            target.flush()
            os.fsync(target.fileno())

        os.chmod(temporary, old_mode)
        repaired_scan = scan_file(temporary)
        expected_snapshots = len(scan.snapshots) - removed_count
        if repaired_scan.errors or len(repaired_scan.snapshots) != expected_snapshots or keep not in repaired_scan.snapshots:
            details = "; ".join(repaired_scan.errors) or "unexpected snapshot count"
            raise RuntimeError(f"repaired file failed validation: {details}")
        os.replace(temporary, scan.path)
        directory_fd = os.open(scan.path.parent, os.O_RDONLY)
        try:
            os.fsync(directory_fd)
        finally:
            os.close(directory_fd)
        return removed_count, scan.path.stat().st_size, backup
    finally:
        temporary.unlink(missing_ok=True)


def session_files(root: Path) -> list[Path]:
    return sorted(root.rglob("*.jsonl"))


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "root",
        nargs="?",
        type=Path,
        default=Path(os.environ.get("PI_CODING_AGENT_SESSION_DIR", "~/.pi/agent/sessions")).expanduser(),
    )
    parser.add_argument("--apply", action="store_true", help="repair affected sessions")
    args = parser.parse_args()

    files = session_files(args.root)
    affected: list[Scan] = []
    invalid: list[Scan] = []
    snapshots = 0
    total_bytes = 0

    for index, path in enumerate(files, 1):
        scan = scan_file(path)
        if scan.errors:
            invalid.append(scan)
        if scan.obsolete_snapshots:
            affected.append(scan)
            snapshots += len(scan.snapshots)
            total_bytes += scan.size
            print(f"affected snapshots={len(scan.snapshots):6d} size={scan.size:12d} {path}")
        if index % 250 == 0:
            print(f"scanned {index}/{len(files)}", file=sys.stderr)

    print(
        f"summary files={len(files)} affected={len(affected)} snapshots={snapshots} "
        f"affected_bytes={total_bytes} invalid={len(invalid)}"
    )
    for scan in invalid:
        print(f"invalid {scan.path}: {'; '.join(scan.errors[:5])}", file=sys.stderr)

    if not args.apply:
        return 2 if invalid else (1 if affected else 0)

    repaired = 0
    removed_total = 0
    bytes_before = 0
    bytes_after = 0
    for scan in affected:
        if not scan.repairable:
            continue
        removed, new_size, backup = repair(scan)
        repaired += 1
        removed_total += removed
        bytes_before += scan.size
        bytes_after += new_size
        print(f"repaired removed={removed:6d} size={scan.size}->{new_size} backup={backup}")

    print(
        f"repair_summary repaired={repaired} removed={removed_total} "
        f"bytes={bytes_before}->{bytes_after} skipped_invalid={len(affected) - repaired}"
    )
    return 2 if invalid else 0


if __name__ == "__main__":
    raise SystemExit(main())
