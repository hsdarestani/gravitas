#!/usr/bin/env python3
"""Publish the approved PR #358 snapshot while preserving the author workspace."""
import argparse
import hashlib
import json
import os
import stat
from pathlib import Path

import django

os.environ.setdefault("DJANGO_SETTINGS_MODULE", "gravitas_backend.settings")
django.setup()

from django.db import connection, transaction
from core.lab_api import _clean_files
from core.models import InteractiveLab, LabRevision

SLUG = "science-universe"
BASELINE = 16
APPROVED = "1c236c89fe5fec8499b8f33a0cf2ba15c2499319"
BASE_HASHES = {
    "index.html": "cb08fd0cab000c9801d089c5522ca03a47bfe22e",
    "app.js": "dd25a46432603def61312f8a0977df4d424754be",
    "styles.css": "62c51a60165ae5d76872ff6efe544f4ee1cec3c8",
    "engine.js": "5a27fcd646924012f741e78294160cef828ed049",
}
APPROVED_HASHES = {
    "index.html": "54eb432c1a8ff740d7d22c3d59086eb863f9414e",
    "app.js": "1958cc2bbe77795a5c30c0c024dfcecd1a1dc2cf",
    "styles.css": "68f4086b292fdd1555649be6e93b055b89fac456",
    "engine.js": BASE_HASHES["engine.js"],
}


def blob(content):
    value = content.encode("utf-8")
    return hashlib.sha1(b"blob " + str(len(value)).encode() + b"\0" + value).hexdigest()


def check_sources(files, expected):
    sources = {row["name"]: row["content"] for row in _clean_files(files)}
    for name, digest in expected.items():
        if name not in sources or blob(sources[name]) != digest:
            raise ValueError(f"Source hash mismatch: {name}")
    return sources


def revision_history(lab, before=None):
    digest = hashlib.sha256()
    fields = ("version", "files", "config", "topic_slug", "actor_id", "created_at")
    history = lab.revisions.all()
    if before is not None:
        history = history.filter(version__lt=before)
    for row in history.order_by("version").values_list(*fields).iterator():
        digest.update(json.dumps(row, ensure_ascii=False, sort_keys=True, default=str).encode())
        digest.update(b"\n")
    return digest.hexdigest()


def read_state(lab):
    return {
        "release": 358,
        "slug": lab.slug,
        "id": lab.pk,
        "published_version": lab.published_version,
        "version": lab.version,
        "published_files": lab.published_files,
        "published_config": lab.published_config,
        "files": lab.files,
        "config": lab.config,
        "topic_slug": lab.topic_slug,
        "title": lab.title,
        "summary": lab.summary,
        "description": lab.description,
        "duration_text": lab.duration_text,
        "history_digest": revision_history(lab),
    }


def load_snapshot(path):
    if path.is_symlink() or not path.is_file() or stat.S_IMODE(path.stat().st_mode) != 0o600:
        raise ValueError("Missing or unsafe private backup")
    data = json.loads(path.read_text(encoding="utf-8"))
    if (data["release"], data["slug"], data["published_version"]) != (358, SLUG, BASELINE):
        raise ValueError("Backup does not identify revision 16")
    check_sources(data["published_files"], BASE_HASHES)
    return data


def target_files(old, source):
    reviewed = check_sources([
        {"name": name, "content": (source / name).read_bytes().decode("utf-8")}
        for name in APPROVED_HASHES
    ], APPROVED_HASHES)
    updated = [
        {**row, "content": reviewed[row["name"]]} if row["name"] in reviewed else row
        for row in old
    ]
    _clean_files(updated)
    return updated


def run(action, source, snapshot, approval=None, *, isolated=False):
    database = connection.settings_dict["NAME"]
    if isolated or action == "rehearse":
        if not database.startswith("gravitas_release358_"):
            raise ValueError("Restore rehearsal requires the isolated release database")
    elif database != "gravitas":
        raise ValueError("Production release expects the gravitas database")
    if action in {"publish", "rollback"} and approval != APPROVED:
        raise ValueError("Explicit approval for the PR #358 commit is required")

    with transaction.atomic():
        lab = InteractiveLab.objects.select_for_update().get(
            slug=SLUG, status=InteractiveLab.Status.PUBLISHED, studio_enabled=True,
        )
        state = read_state(lab)
        saved = None if action == "capture" else load_snapshot(snapshot)
        original = saved or state
        check_sources(original["published_files"], BASE_HASHES)
        if original["published_version"] != BASELINE or original["version"] < BASELINE:
            raise ValueError("Expected published revision 16 and a valid draft version")
        updated = target_files(original["published_files"], source)
        next_version = original["version"] + 1
        if action in {"capture", "preflight", "rehearse", "publish"}:
            if saved is not None and state != saved:
                raise ValueError("Published snapshot, editable draft, or history changed since backup")
            if action == "capture":
                print(json.dumps(state, ensure_ascii=False, separators=(",", ":")))
                return
            if action == "publish":
                LabRevision.objects.create(lab=lab, version=next_version, files=lab.files,
                                           config=lab.config, topic_slug=lab.topic_slug)
                lab.published_files = updated
                lab.version = lab.published_version = next_version
                lab.save(update_fields=["published_files", "published_version", "version", "updated_at"])
                print(f"PUBLISHED_REVISION={next_version}")
                return
            if action == "rehearse":
                run("publish", source, snapshot, APPROVED, isolated=True)
                run("verify", source, snapshot, isolated=True)
                run("rollback", source, snapshot, APPROVED, isolated=True)
                lab.refresh_from_db()
                restored = read_state(lab)
                for key in ("published_version", "published_files", "published_config", "files", "config"):
                    if restored[key] != saved[key]:
                        raise ValueError(f"Rehearsed rollback differs from revision 16: {key}")
                transaction.set_rollback(True)
                print("ISOLATED_RESTORE_AND_ROLLBACK_VERIFIED=16")
            else:
                print("PRODUCTION_DRY_RUN_VERIFIED")
            return

        if (lab.pk != saved["id"] or lab.published_version != next_version or
                lab.published_config != saved["published_config"] or lab.published_files != updated):
            raise ValueError("Unexpected public state; refusing release verification or rollback")
        if action == "rollback":
            # Leave all drafts and revision rows as they are, including newer editor changes.
            lab.published_files = saved["published_files"]
            lab.published_version = BASELINE
            lab.save(update_fields=["published_files", "published_version", "updated_at"])
            print("ROLLBACK_VERIFIED=16")
            return

        revision = lab.revisions.get(version=next_version)
        if (revision.files, revision.config, revision.topic_slug, revision.actor_id) != (
                saved["files"], saved["config"], saved["topic_slug"], None):
            raise ValueError("Author history checkpoint differs from the backup")
        for field in ("files", "config", "topic_slug", "title", "summary", "description", "duration_text"):
            if state[field] != saved[field]:
                raise ValueError(f"Author data changed after publication: {field}")
        # Compare the existing history independently of the newly created checkpoint.
        if revision_history(lab, before=next_version) != saved["history_digest"]:
            raise ValueError("Prior revision history differs from the backup")
        print(f"RELEASE_VERIFIED={next_version}")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("action", choices=("capture", "preflight", "rehearse", "publish", "verify", "rollback"))
    parser.add_argument("--source", type=Path, required=True)
    parser.add_argument("--snapshot", type=Path, required=True)
    parser.add_argument("--approved-commit")
    args = parser.parse_args()
    try:
        run(args.action, args.source, args.snapshot, args.approved_commit)
    except (ValueError, OSError, KeyError, InteractiveLab.DoesNotExist, LabRevision.DoesNotExist) as exc:
        parser.exit(1, f"SCIENCE_358_RELEASE_STOPPED: {exc}\n")
