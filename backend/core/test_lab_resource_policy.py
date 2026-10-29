"""Regressions for public Lab files in an opaque-origin iframe."""
from django.test import SimpleTestCase

from core.lab_api import _serve_file


class LabRunResourcePolicyTests(SimpleTestCase):
    files = [
        {'name': 'index.html', 'content': '<!doctype html><html><head></head><body></body></html>'},
        {'name': 'styles.css', 'content': 'body { color: white; }'},
        {'name': 'app.js', 'content': 'window.running = true;'},
        {'name': 'notes.txt', 'content': 'public notes'},
    ]

    def test_html_remains_same_origin_and_sandboxed(self):
        response = _serve_file(self.files, 'index.html')
        self.assertEqual(response['Cross-Origin-Resource-Policy'], 'same-origin')
        self.assertIn('sandbox allow-scripts', response['Content-Security-Policy'])
        self.assertNotIn('allow-same-origin', response['Content-Security-Policy'])
        self.assertIn('frame-ancestors', response['Content-Security-Policy'])
        self.assertEqual(response['X-Frame-Options'], 'SAMEORIGIN')

    def test_public_css_loads_from_opaque_origin(self):
        response = _serve_file(self.files, 'styles.css')
        self.assertEqual(response['Cross-Origin-Resource-Policy'], 'cross-origin')
        self.assertTrue(response['Content-Type'].startswith('text/css'))
        self.assertEqual(response['X-Content-Type-Options'], 'nosniff')

    def test_public_js_loads_from_opaque_origin(self):
        response = _serve_file(self.files, 'app.js')
        self.assertEqual(response['Cross-Origin-Resource-Policy'], 'cross-origin')
        self.assertIn('javascript', response['Content-Type'])
        self.assertIn('sandbox allow-scripts', response['Content-Security-Policy'])

    def test_other_files_do_not_get_cross_origin_policy(self):
        response = _serve_file(self.files, 'notes.txt')
        self.assertEqual(response['Cross-Origin-Resource-Policy'], 'same-origin')
