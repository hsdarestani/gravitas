#!/usr/bin/env python3
"""Check the public Lab revision and exact runtime bytes, accounting for HTML injection."""
import hashlib
import json
import re
import sys
from urllib.request import Request, urlopen

BASELINE = {
    "index.html": "cb08fd0cab000c9801d089c5522ca03a47bfe22e",
    "app.js": "dd25a46432603def61312f8a0977df4d424754be",
    "styles.css": "62c51a60165ae5d76872ff6efe544f4ee1cec3c8",
    "engine.js": "5a27fcd646924012f741e78294160cef828ed049",
}
APPROVED = {
    "index.html": "54eb432c1a8ff740d7d22c3d59086eb863f9414e",
    "app.js": "1958cc2bbe77795a5c30c0c024dfcecd1a1dc2cf",
    "styles.css": "68f4086b292fdd1555649be6e93b055b89fac456",
    "engine.js": BASELINE["engine.js"],
}
INJECTED = (
    rb'<script src="/assets/lab-bridge\.js\?v=[A-Za-z0-9.-]+"></script>',
    rb'<link rel="stylesheet" href="/assets/cms-public.css">',
    rb'<meta name="robots" content="noindex, nofollow">',
    rb'<script src="/assets/production-cleanup.js"></script>',
    rb'<script src="/assets/cms-live.js"></script>',
    rb'<script src="/assets/cms-links.js"></script>',
    rb'<script src="/assets/consent.js"></script>',
)


def get(path):
    request = Request("https://graviquest.com" + path, headers={"Cache-Control": "no-cache"})
    with urlopen(request, timeout=12) as response:
        return response.read()


def verify(revision, expected):
    lab = json.loads(get("/api/labs/science-universe/"))["lab"]
    if lab["published_version"] != revision or not lab["ready"]:
        raise ValueError(f"Expected public revision {revision}, received {lab['published_version']}")
    for name, digest in expected.items():
        body = get("/lab-run/science-universe/" + ("" if name == "index.html" else name))
        if name == "index.html":
            for token in INJECTED:
                body = re.sub(token, b"", body, count=1)
        actual = hashlib.sha1(b"blob " + str(len(body)).encode() + b"\0" + body).hexdigest()
        if actual != digest:
            raise ValueError(f"Public asset hash mismatch: {name} ({actual})")
    print(f"PUBLIC_REVISION_AND_ALL_ASSETS_VERIFIED={revision}")


if __name__ == "__main__":
    verify(int(sys.argv[1]), {"baseline": BASELINE, "approved": APPROVED}[sys.argv[2]])
