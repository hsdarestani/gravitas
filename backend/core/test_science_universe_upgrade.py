"""Guardrails: science model upgrades must never overwrite independent Lab edits."""
from pathlib import Path

from django.test import SimpleTestCase

from core.management.commands.upgrade_science_universe_science import (
    ROOT, NAMES, EXPECTED, blob_sha, upgrade_file_set
)


class ScienceUniverseSafeUpgradeTests(SimpleTestCase):
    def setUp(self):
        self.sources = {name: (ROOT / name).read_text(encoding='utf-8') for name in NAMES}
        self.files = [{'name': name, 'content': value} for name, value in self.sources.items()]

    def test_published_upgrade_idempotent_for_new_scientific_sources(self):
        upgraded = upgrade_file_set(self.files, self.sources)
        self.assertEqual(upgraded, self.files)

    def test_author_modified_engine_refused(self):
        files = [dict(row) for row in self.files]
        files[0]['content'] += '\n// independent author edits'
        with self.assertRaisesRegex(ValueError, 'author_modified_'):
            upgrade_file_set(files, self.sources)

    def test_missing_source_refused(self):
        with self.assertRaisesRegex(ValueError, 'source_file_missing'):
            upgrade_file_set(self.files[:-1], self.sources)

    def test_git_blob_hash_stable(self):
        self.assertEqual(blob_sha('hello'), 'b6fc4c620b67d95f953a5c1c1230aaab5db5a1b0')

    def test_exact_reviewed_pre_progressive_release_sources_are_allowlisted(self):
        # These are the actual Git blobs on main immediately before PR #347,
        # not wildcards or guessed historical file identities.
        checked = {
            'index.html': '6580855aabe78f7324ba5a5131255ad9a7ef0430',
            'app.js': '07bf2406f956803b8b0adbebccf989680ccec766',
            'styles.css': '8f6c41b2e86299e875da036c2604ef4e45c9404e',
        }
        for name, sha in checked.items():
            with self.subTest(name=name):
                self.assertIn(sha, EXPECTED[name])

    def test_unknown_author_index_still_refused(self):
        files = [dict(row) for row in self.files]
        for row in files:
            if row['name'] == 'index.html':
                row['content'] += '\\n<!-- independent author edit -->'
        with self.assertRaisesRegex(ValueError, 'author_modified_index.html'):
            upgrade_file_set(files, self.sources)

    def test_known_v3_app_hash_is_allowlisted(self):
        self.assertIn('39582357f5ff293bffbc6bdf4b5ec84699884c7b', EXPECTED['app.js'])
