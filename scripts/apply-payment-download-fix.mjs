import fs from 'node:fs';

const pagePath = 'app/page.js';
const cssPath = 'app/globals.css';
let s = fs.readFileSync(pagePath, 'utf8');

if (!s.includes('const RECOVERY_WINDOW_MS = 45 * 60 * 1000;')) {
  s = s.replace("const PAID_ORDER_STORAGE_KEY = `fm_paid_order_${EVENT_SLUG}`;\n", "const PAID_ORDER_STORAGE_KEY = `fm_paid_order_${EVENT_SLUG}`;\nconst RECOVERY_WINDOW_MS = 45 * 60 * 1000;\n");
}
if (!s.includes('const [downloadAttempted, setDownloadAttempted]')) {
  s = s.replace("  const [downloadStarted, setDownloadStarted] = useState(false);\n", "  const [downloadStarted, setDownloadStarted] = useState(false);\n  const [downloadAttempted, setDownloadAttempted] = useState(false);\n  const [staleOrder, setStaleOrder] = useState(null);\n  const downloadLockRef = useRef(false);\n");
}
const recovery = `  const hydrateApprovedOrder = async (savedOrderId, { silent = false } = {}) => {
    if (!savedOrderId) return false;
    try {
      const res = await fetch(\`/api/orders/\${savedOrderId}/status\`, { cache: 'no-store' });
      const body = await res.json().catch(() => ({}));
      if (!res.ok || !body?.order) {
        if (res.status === 404) removeStoredOrder();
        return false;
      }
      const status = body.order.status;
      if (status === 'rejected') { removeStoredOrder(); return false; }
      if (status !== 'approved' && status !== 'fulfilled') return false;
      const restoredIds = Array.isArray(body.order.selected_photo_ids) ? body.order.selected_photo_ids.map(String) : [];
      setOrderId(body.order.id);
      setPaymentSent(true);
      setPaymentLoading(false);
      setStaleOrder(null);
      setDownloadStarted(false);
      setDownloadAttempted(false);
      if (restoredIds.length) setSelected(restoredIds);
      if (!silent) {
        setMatchMessage(restoredIds.length
          ? \`Payment already verified for \${restoredIds.length} photo\${restoredIds.length === 1 ? '' : 's'}. Your originals are ready to download.\`
          : 'Payment already verified. Your original photos are ready to download.');
      }
      rememberApprovedOrder(body.order.id, restoredIds);
      return true;
    } catch (error) {
      console.warn('Could not recover paid order:', error);
      return false;
    }
  };

  const removeStoredOrder = () => {
    if (typeof window === 'undefined') return;
    try { window.localStorage.removeItem(PAID_ORDER_STORAGE_KEY); } catch {}
  };

  const recoverStaleOrder = async () => {
    if (!staleOrder?.orderId) return;
    await hydrateApprovedOrder(staleOrder.orderId);
  };

  useEffect(() => {
    let cancelled = false;
    const recoverPaidOrder = async () => {
      if (typeof window === 'undefined') return;
      try {
        const raw = window.localStorage.getItem(PAID_ORDER_STORAGE_KEY);
        if (!raw) return;
        const saved = JSON.parse(raw);
        if (!saved?.orderId || cancelled) return;
        const savedAt = Number(saved.savedAt || 0);
        const isRecent = savedAt > 0 && (Date.now() - savedAt) < RECOVERY_WINDOW_MS;
        if (isRecent) { await hydrateApprovedOrder(saved.orderId); return; }
        if (!cancelled) setStaleOrder({ orderId: saved.orderId });
      } catch (error) {
        console.warn('Could not recover paid order:', error);
      }
    };
    recoverPaidOrder();
    return () => { cancelled = true; };
  }, []);

`;
const recoveryPattern = /  useEffect\(\(\) => \{\n    let cancelled = false;\n\n    const recoverPaidOrder = async \(\) => \{[\s\S]*?\n  \}, \[\]\);\n\n/;
if (recoveryPattern.test(s)) s = s.replace(recoveryPattern, recovery);
else if (!s.includes('const hydrateApprovedOrder = async')) throw new Error('Could not find paid-order recovery effect');

const downloadHelper = `  const downloadApprovedPhotos = async (approvedOrderId) => {
    if (!approvedOrderId || !selected.length || downloadLockRef.current) return;
    downloadLockRef.current = true;
    setDownloadStarting(true);
    setDownloadAttempted(true);
    setMatchMessage('Preparing your original photo download…');
    try {
      const response = await fetch(\`/api/orders/\${approvedOrderId}/download-zip\`, { method: 'GET', cache: 'no-store' });
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw new Error(body?.error || 'Could not prepare the download.');
      }
      const blob = await response.blob();
      const objectUrl = URL.createObjectURL(blob);
      const disposition = response.headers.get('content-disposition') || '';
      const nameMatch = /filename="?([^";]+)"?/i.exec(disposition);
      const link = document.createElement('a');
      link.href = objectUrl;
      link.download = nameMatch?.[1] || \`SMF-Photos-\${String(approvedOrderId).slice(0, 8)}.zip\`;
      link.style.display = 'none';
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(objectUrl), 30000);
      setDownloadStarted(true);
      setMatchMessage('Your original photos are downloading.');
    } catch (error) {
      setDownloadStarted(false);
      setMatchMessage(error?.message ? \`\${error.message} Use “Download Originals” to retry.\` : 'Could not start the download. Use “Download Originals” to retry.');
    } finally {
      downloadLockRef.current = false;
      setDownloadStarting(false);
    }
  };

`;
const downloadPattern = /  const downloadApprovedPhotos = async \(approvedOrderId\) => \{[\s\S]*?\n  \};\n\n  const rememberApprovedOrder/;
if (!downloadPattern.test(s)) throw new Error('Could not find download helper');
s = s.replace(downloadPattern, `${downloadHelper}  const rememberApprovedOrder`);

const rememberNeedle = `            if (approvedId) {\n              await downloadApprovedPhotos(approvedId);\n            }`;
if (s.includes(rememberNeedle)) s = s.replace(rememberNeedle, `            if (approvedId) {\n              rememberApprovedOrder(approvedId, selected);\n              await downloadApprovedPhotos(approvedId);\n            }`);

s = s.replace('if (!orderId || !paymentSent || downloadStarted) return undefined;', 'if (!orderId || !paymentSent || downloadAttempted || !selected.length) return undefined;');
s = s.replace('}, [orderId, paymentSent, downloadStarted]);', '}, [orderId, paymentSent, downloadAttempted, selected]);');

const noticeNeedle = '      {paymentSent && <div className="notice successNotice"><CheckCircle2 size={17}/> Payment verified successfully. Your original downloads are starting now.{orderId && <> Order: <code>{orderId}</code></>}</div>}';
if (s.includes(noticeNeedle)) {
  s = s.replace(noticeNeedle, `      {paymentSent && <div className="notice successNotice"><CheckCircle2 size={17}/> Payment verified successfully. Your original downloads are ready.{orderId && <> Order: <code>{orderId}</code></>}</div>}
      {paymentSent && orderId && <div className="notice downloadRecoveryNotice"><div><b>Originals ready</b><span>Your payment is already verified. You can retry the download anytime without paying again.</span></div><button type="button" className="primaryButton" onClick={() => downloadApprovedPhotos(orderId)} disabled={downloadStarting}>{downloadStarting ? <><Loader2 size={17} className="spin"/> Preparing…</> : <>{downloadAttempted ? 'Download again' : 'Download Originals'} <ArrowRight size={17}/></>}</button></div>}
      {!paymentSent && staleOrder && <div className="notice staleOrderNotice"><span>Paid for photos before on this device?</span><button type="button" className="linkButton" onClick={recoverStaleOrder}>Recover my download</button></div>}`);
}

s = s.replace('{selected.length > 0 && <div className="checkoutBar">', '{selected.length > 0 && !paymentSent && <div className="checkoutBar">');
fs.writeFileSync(pagePath, s);

let c = fs.readFileSync(cssPath, 'utf8');
if (!c.includes('.downloadRecoveryNotice{')) {
  c += `\n\n.downloadRecoveryNotice{justify-content:space-between;flex-wrap:wrap;gap:14px;padding:16px 18px}
.downloadRecoveryNotice>div{display:flex;flex-direction:column;gap:2px}
.downloadRecoveryNotice b{color:#f2eee6;font-size:11px}
.downloadRecoveryNotice span{color:#9e9890;font-size:10px}
.downloadRecoveryNotice .primaryButton{white-space:nowrap}
.staleOrderNotice{justify-content:center;gap:10px}
.linkButton{background:none;border:0;padding:0;color:#e8c988;font-size:10px;font-weight:700;text-decoration:underline;cursor:pointer}
.linkButton:hover{color:#f4d99f}
@media (max-width:640px){.downloadRecoveryNotice{align-items:stretch}.downloadRecoveryNotice .primaryButton{width:100%}}
`;
  fs.writeFileSync(cssPath, c);
}

console.log('Payment/download recovery fix applied at build time.');
