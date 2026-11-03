#!/usr/bin/env python3
"""Assemble the single-file variations page: fixture + screenshots + kit + variants + harness."""
import base64, glob, json, os, subprocess, sys, tempfile
HERE = os.path.dirname(os.path.abspath(__file__))
SRC_DATA, SRC_SHOTS = sys.argv[1], sys.argv[2]
ONLY = sys.argv[3] if len(sys.argv) > 3 else None

def load(n):
    return json.load(open(os.path.join(SRC_DATA, n + '.json')))

def scrub(rows):
    names = {'usr_dana': 'Dana S.', 'pat_chen_j': 'J. Chen', 'inbox.edit_note': 'Note saved'}
    return [{k: names.get(v, v) if isinstance(v, str) else v for k, v in r.items()} for r in rows]

inbox = load('inbox')
items = []
for it in inbox['items']:
    items.append({**it, **load('item_' + it['id'])})
order = {i['id']: n for n, i in enumerate(inbox['items'])}
claims = {}
for f in glob.glob(os.path.join(SRC_DATA, 'claim_*.json')):
    c = json.load(open(f))
    claims[c['claim']['id']] = c
cl = load('claims')['items']
keep = [c for c in cl if c['status'] in ('sent', 'ready')][:12] + [c for c in cl if c['status'] in ('pending', 'accepted')][:24]
data = {
    'items': items, 'groups': inbox['groups'], 'strip': load('strip'), 'denials': load('denials'), 'agents': load('agents'),
    'clock': load('clock'), 'claims': claims, 'activity': scrub(load('activity')['rows']),
    'claimsList': [{k: c.get(k) for k in ('id', 'number', 'status', 'needs_action', 'patient', 'payer', 'dos', 'procedures', 'billed_cents', 'age_days', 'reason', 'agent_note')} for c in keep],
    'copy': json.load(open(os.path.join(HERE, 'copy.json'))),
}
shots = {}
for key, name in {'inbox': 'inbox', 'inboxGroup': 'inbox-group', 'inboxDraft': 'inbox-draft', 'claim': 'claim-4821', 'denials': 'denials'}.items():
    with tempfile.TemporaryDirectory() as t:
        out = os.path.join(t, 'x.jpg')
        subprocess.run(['sips', '-s', 'format', 'jpeg', '-s', 'formatOptions', '78', '-Z', '2000', os.path.join(SRC_SHOTS, name + '.png'), '--out', out], check=True, capture_output=True)
        shots[key] = 'data:image/jpeg;base64,' + base64.b64encode(open(out, 'rb').read()).decode()

def js(path):
    return open(path).read().replace('</script', '<\\/script')

parts = ['<script>window.TORCH_DATA=' + json.dumps(data, ensure_ascii=False).replace('</', '<\\/') + ';window.TORCH_SHOTS=' + json.dumps(shots) + ';</script>']
parts.append('<script>' + js(os.path.join(HERE, 'src/kit.js')) + '</script>')
parts.append('<script>' + js(os.path.join(HERE, 'src/original.js')) + '</script>')
for v in (ONLY or 'abcde'):
    p = os.path.join(HERE, 'variants', v + '.js')
    if os.path.exists(p):
        parts.append('<script>' + js(p) + '</script>')
parts.append('<script>' + js(os.path.join(HERE, 'src/harness.js')) + '</script>')
html = open(os.path.join(HERE, 'src/harness.html')).read().replace('<!--SCRIPTS-->', '\n'.join(parts))
os.makedirs(os.path.join(HERE, 'dist'), exist_ok=True)
out = os.path.join(HERE, 'dist', f'only-{ONLY}.html' if ONLY else 'torch-variations.html')
open(out, 'w').write(html)
print(out, round(os.path.getsize(out) / 1e6, 2), 'MB')
