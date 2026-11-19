"""Assemble a native theme from tracked source and the existing brand fonts.

The fonts become Discourse theme uploads. They require neither a permissive
CORS header on the main website nor a weakened content security policy.
"""
import json
import shutil
import re
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
    # The public guide is the exact shared website widget. Bundle its source
    # into the native theme, rather than loading cross-origin scripts or
    # maintaining a second assistant with different behavior.
    module = destination/'javascripts/discourse/lib/gq-pulsar.js'
    module.parent.mkdir(parents=True, exist_ok=True)
    module.write_text('export default function mountPulsar() {\n' + (source/'assets/chat.js').read_text() + '\n}\n')
    brand = re.sub(r'/\*.*?\*/', '', (source/'assets/gravitas.css').read_text(), flags=re.S)
    dark = re.search(r':root\s*\{([^}]+)\}', brand)[1]
    light = re.search(r':root\[data-theme="light"\]\s*\{([^}]+)\}', brand)[1]
    with (destination/'common/common.scss').open('a') as stylesheet:
        stylesheet.write('\n/* Shared Pulsar, with brand tokens scoped to the widget. */\n')
        stylesheet.write('.gchat {' + dark + '}\n:root[data-theme="light"] .gchat {' + light + '}\n')
        stylesheet.write((source/'assets/chat.css').read_text())
        stylesheet.write('\n.gchat, .gchat * { box-sizing: border-box; }\n')


if __name__ == '__main__':
    assemble(Path(sys.argv[1]),Path(sys.argv[2]))
