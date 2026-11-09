import json, sys, urllib.request, urllib.error, os
B = __import__('os').environ.get('API', 'http://localhost:8100/api/v1')
OUT = os.environ['RAW']  # <capture-dir>/payloads/raw
def get(name, path, user='usr_dana'):
    req = urllib.request.Request(B + path, headers={'X-Torch-User': user})
    try:
        with urllib.request.urlopen(req) as r: body = json.load(r); code = r.status
    except urllib.error.HTTPError as e:
        body = json.load(e); code = e.code
    json.dump({'request': f'GET {path}', 'user': user, 'status': code, 'body': body}, open(f'{OUT}/{name}.json', 'w'), indent=1)
    print(code, name, len(json.dumps(body)))
phase = sys.argv[1]
if phase == 'wed':
    for n, p, u in [
        ('strip', '/summary/strip', 'usr_dana'), ('inbox', '/inbox', 'usr_dana'), ('inbox_4821', '/inbox/itm_4821', 'usr_dana'),
        ('claim_4821', '/claims/clm_4821', 'usr_dana'), ('claim_4744', '/claims/clm_4744', 'usr_dana'),
        ('timeline_4821', '/claims/clm_4821/timeline', 'usr_dana'), ('claims_denied', '/claims?status=denied', 'usr_dana'),
        ('claims', '/claims', 'usr_dana'), ('ledger', '/ledger/today', 'usr_dana'), ('rules', '/rules', 'usr_dana'),
        ('changes', '/rules/changes', 'usr_dana'), ('proposals', '/proposals', 'usr_dana'),
        ('preview_delta_auto', '/settings/preview?rule_id=rule_t1_delta_pa&mode=auto', 'usr_dana'),
        ('activity', '/activity', 'usr_dana'), ('activity_followup', '/activity?agent=followup', 'usr_dana'),
        ('cash', '/cash', 'usr_morgan'), ('cash_dana', '/cash', 'usr_dana'), ('denials', '/denials', 'usr_dana'),
        ('eligibility', '/eligibility', 'usr_dana'), ('remittances', '/remittances', 'usr_dana'),
        ('runs', '/runs', 'usr_dana'), ('agents_status', '/agents/status', 'usr_dana'), ('clock', '/clock', 'usr_dana'),
        ('world_payers', '/_world/payers', 'usr_dana'), ('views', '/views', 'usr_dana'), ('balances', '/patients/balances', 'usr_dana'),
        ('strip_morgan', '/summary/strip', 'usr_morgan'), ('inbox_morgan', '/inbox', 'usr_morgan'),
    ]: get(n, p, u)
else:
    for a in sys.argv[2:]:
        n, p, u = a.split('|'); get(n, p, u)
