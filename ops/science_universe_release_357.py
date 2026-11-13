#!/usr/bin/env python3
"""One-time guarded Science Universe PR #357 publication witness and targeted rollback.

Run only on the production server under the gravitas service identity.
The release snapshot is private and must never be uploaded to CI artifacts.
The application model/engine is not modified by this script.
"""
import argparse
import json
import os
import sys
from pathlib import Path

os.environ.setdefault("DJANGO_SETTINGS_MODULE", "gravitas_backend.settings")
import django
django.setup()

from django.db import transaction
from core.models import InteractiveLab
from core.management.commands.upgrade_science_universe_science import (
    ROOT, NAMES, upgrade_file_set,
)

SLUG = "science-universe"
BASELINE = 15


def live(lock=False):
    query = InteractiveLab.objects
    if lock:
        query = query.select_for_update()
    lab = query.get(slug=SLUG, status=InteractiveLab.Status.PUBLISHED, studio_enabled=True)
    return lab


def sources():
    return {name: (ROOT / name).read_text(encoding="utf-8") for name in NAMES}


def load_snapshot(path):
    p = Path(path)
    if not p.is_file() or p.is_symlink():
        raise RuntimeError("Release snapshot missing or unsafe")
    data = json.loads(p.read_text(encoding="utf-8"))
    if data.get("release") != 357 or data.get("slug") != SLUG or data.get("published_version") != BASELINE:
        raise RuntimeError("Snapshot does not identify the approved revision")
    if not isinstance(data.get("published_files"), list) or not isinstance(data.get("files"), list):
        raise RuntimeError("Incomplete Lab snapshot")
    return data


def snapshot():
    with transaction.atomic():
        lab = live(lock=True)
        if lab.published_version != BASELINE or lab.version < BASELINE:
            raise RuntimeError("Refusing snapshot: published version must be 15 and draft version must not be older")
        data = {
            "release": 357,
            "slug": SLUG,
            "lab_id": lab.pk,
            "published_version": lab.published_version,
            "version": lab.version,
            "published_files": lab.published_files,
            "files": lab.files,
            "title": lab.title,
            "summary": lab.summary,
            "duration_text": lab.duration_text,
        }
        # stdout is redirected to a private file by the release workflow.
        print(json.dumps(data, ensure_ascii=False, separators=(",", ":")))


def expected_draft(data, replacements):
    try:
        return upgrade_file_set(data["files"], replacements)
    except ValueError as exc:
        if str(exc).startswith("author_modified_"):
            return data["files"]
        raise


def check_before(path):
    data = load_snapshot(path)
    with transaction.atomic():
        lab = live(lock=True)
        if lab.pk != data["lab_id"] or lab.version != data["version"] or lab.published_version != BASELINE:
            raise RuntimeError("Live Lab identity/version changed since the snapshot")
        for key in ("published_files", "files", "title", "summary", "duration_text"):
            if getattr(lab, key) != data[key]:
                raise RuntimeError("Live Lab changed after capture: " + key)
        replacement = sources()
        if upgrade_file_set(data["published_files"], replacement) == data["published_files"]:
            raise RuntimeError("Approved source is not a new published revision")
        expected_draft(data, replacement)
    print("PREFLIGHT_OK: revision 15 unchanged; approved files pass hash guard")


def check_after(path):
    data = load_snapshot(path)
    replacement = sources()
    expected = upgrade_file_set(data["published_files"], replacement)
    with transaction.atomic():
        lab = live(lock=True)
        if lab.pk != data["lab_id"] or lab.published_version != data["version"] + 1 or lab.version != data["version"] + 1:
            raise RuntimeError("Unexpected version or Lab identity after publication")
        if lab.published_files != expected:
            raise RuntimeError("Published Lab files differ from the approved source")
        if lab.files != expected_draft(data, replacement):
            raise RuntimeError("Author draft changed unexpectedly")
    print("PUBLISHED_VERIFIED: approved source matched; drafts preserved")


def rollback(path):
    data = load_snapshot(path)
    replacement = sources()
    expected_published = upgrade_file_set(data["published_files"], replacement)
    expected_author = expected_draft(data, replacement)
    with transaction.atomic():
        lab = live(lock=True)
        if lab.pk != data["lab_id"] or lab.published_version != data["version"] + 1 or lab.version != data["version"] + 1:
            raise RuntimeError("Unsafe rollback: Lab version changed. Requires manual reconciliation.")
        if lab.published_files != expected_published:
            raise RuntimeError("Unsafe rollback: published files changed. Requires manual reconciliation.")
        # Never discard independent editor changes made after publication.
        fields = ["published_files", "published_version", "updated_at"]
        lab.published_files = data["published_files"]
        lab.published_version = BASELINE
        if lab.files == expected_author:
            lab.files = data["files"]
            fields.append("files")
        # Keep monotonically increasing draft version and its revision history.
        # Revert metadata only if it still equals the release-owned value.
        metadata = {
            "title": "Science Ecosystem" if data["title"] in
                     ("Science Universe", "Science Universe — The Discovery Engine") else data["title"],
            "summary": "Can peer review keep up with faster research? Test one setting with Pulsar, then compare two worlds and explore the full research network."
                       if data["summary"].startswith("Explore an evolving research ecosystem.") else data["summary"],
            "duration_text": "Start in 2 min" if data["duration_text"] == "15–25 min" else data["duration_text"],
        }
        for key, owned in metadata.items():
            if getattr(lab, key) == owned:
                setattr(lab, key, data[key])
                fields.append(key)
        lab.save(update_fields=fields)
    print("ROLLBACK_VERIFIED: published revision restored to 15; historical draft version retained")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("action", choices=("capture", "preflight", "verify", "rollback"))
    parser.add_argument("--snapshot")
    args = parser.parse_args()
    if args.action != "capture" and not args.snapshot:
        parser.error("--snapshot is required")
    try:
        if args.action == "capture":
            snapshot()
        elif args.action == "preflight":
            check_before(args.snapshot)
        elif args.action == "verify":
            check_after(args.snapshot)
        else:
            rollback(args.snapshot)
    except Exception as exc:
        print("SCIENCE_RELEASE_FAILED: " + str(exc), file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
