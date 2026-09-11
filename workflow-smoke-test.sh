#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")" && pwd)"
"${PYTHON:-python3}" - "$ROOT/index.html" "$ROOT/_inline.js" <<'PY'
import re,sys,pathlib
html=pathlib.Path(sys.argv[1]).read_text()
parts=[m.group(1) for m in re.finditer(r'<script(?:\s[^>]*)?>(.*?)</script>',html,re.S|re.I)]
pathlib.Path(sys.argv[2]).write_text('\n;\n'.join(parts))
checks={
 'lead conversion': 'convertLead',
 'customer loading': 'loadCustomers',
 'job loading': 'loadJobs',
 'materials': 'openMaterials',
 'estimate save': 'fieldops_create_quote',
 'estimate send': 'setEstimateStatus',
 'estimate approval': "setEstimateStatus('${id}','approved')",
 'invoice creation': 'createInvoiceFromEstimate',
 'invoice send': 'markInvoiceSent',
 'payment recording': 'recordPayment',
 'tax books': 'loadTaxBooks',
 'auto markup': 'matComputedPrice',
 'complete to invoice': '/api/complete-job',
 'invoice editor': 'openInvoiceEditor',
 'signature status': '/api/signature-status',
 'csv export': 'exportTaxCsv',
 'AI lead reply': 'aiReply',
 'AI estimate': '/api/estimate-assist',
 'AI invoice': '/api/invoice-assist',
 'estimate AI auth': "'x-fieldops-key':accessKey",
 'atomic payment path': "action:'payment'",
}
missing=[k for k,v in checks.items() if v not in html]
if missing: raise SystemExit('Missing workflow checks: '+', '.join(missing))
for bad in ('SUPABASE_URL','PUBLISHABLE_KEY','loadLeads()'):
    if bad in html: raise SystemExit('Stale broken reference remains: '+bad)
print('workflow references OK')
PY
node --check "$ROOT/_inline.js"
rm "$ROOT/_inline.js"
for f in "$ROOT"/api/*.js "$ROOT"/lib/*.js "$ROOT"/document-system.js; do node --check "$f"; done
grep -q "a1-fieldops-v31.8.1" "$ROOT/service-worker.js"
echo "All local workflow smoke tests passed."
