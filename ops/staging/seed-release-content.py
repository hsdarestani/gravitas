"""Publish representative synthetic content only to the staging origin."""
import os

from staging_client import StageClient


SLUG = 'synthetic-graviquest-motion-lab'
FILES = [
    {'name': 'index.html', 'content': '''<!doctype html><html lang="en">
<head><meta charset="utf-8"><title>Staging motion Lab</title></head>
<body><main><h1>Synthetic motion Lab</h1>
<label>Acceleration (m/s²) <input id="acceleration" type="number" min="0" max="10" value="2"></label>
<button id="run" type="button">Run simulation</button>
<output id="distance" aria-live="polite">Set an acceleration, then run for 3 seconds.</output>
</main><script src="app.js"></script></body></html>'''},
    {'name': 'app.js', 'content': '''const acceleration = document.getElementById('acceleration');
const distance = document.getElementById('distance');
document.getElementById('run').addEventListener('click', () => {
  const value = Number(acceleration.value);
  if (!acceleration.value || value < 0 || value > 10) {
    distance.textContent = 'Enter an acceleration between 0 and 10.';
    return;
  }
  distance.textContent = 'Distance after 3 seconds: ' + (0.5 * value * 3 ** 2).toFixed(1) + ' m';
});'''},
]


if __name__ == '__main__':
    public, owner = StageClient(), StageClient()
    owner.sign_in(os.environ['STAGE_OWNER_EMAIL'], os.environ['STAGE_OWNER_PASSWORD'])
    try:
        labs = '/api/platform/admin/labs/'
        existing = next((lab for lab in owner.call(labs)['labs'] if lab['slug'] == SLUG), None)
        if existing is None:
            item = owner.call(labs, 'POST', {
                'slug': SLUG, 'title': 'Synthetic motion Lab',
                'summary': 'A staging-only fixture for checking constant acceleration.',
                'files': FILES, 'config': {'components': ['stage', 'controls', 'metrics'], 'pulsar_enabled': False},
            }, status=201)['lab']
            owner.call(f"{labs}{item['id']}/publish/", 'POST', {'version': item['version']})
        elif existing['title'] != 'Synthetic motion Lab' or not existing['published_version']:
            raise RuntimeError('Existing fixture requires review; preserve its data')
        page = public.call('/lab-run/' + SLUG + '/')
        assert 'Synthetic motion Lab' in page and 'Run simulation' in page
        assert any(lab['slug'] == SLUG for lab in public.call('/api/labs/')['labs'])
        print('Synthetic staging Lab is published and appears in the public staging catalog.')
    finally:
        owner.sign_out()
