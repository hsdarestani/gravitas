"""Assemble a native theme from tracked source and the existing brand fonts.

The fonts become Discourse theme uploads. They require neither a permissive
CORS header on the main website nor a weakened content security policy.
"""
import json
import shutil
import sys
from pathlib import Path


def assemble(source, destination):
    about = json.loads((source/'discourse/theme/about.json').read_text())
    if destination.exists():
        previous = json.loads((destination/'about.json').read_text())
        if previous.get('name') != about['name']:
            raise ValueError('Refusing to replace an unrelated theme directory')
        shutil.rmtree(destination)
    shutil.copytree(source/'discourse/theme',destination)
    for relative in about.get('assets',{}).values():
        target=destination/relative
        target.parent.mkdir(parents=True,exist_ok=True)
        shutil.copy2(source/'assets/fonts'/target.name,target)


if __name__ == '__main__':
    assemble(Path(sys.argv[1]),Path(sys.argv[2]))
