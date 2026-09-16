'use client';

import { useEffect, useRef, useState } from 'react';
import { ArrowRight, CheckCircle2, Loader2, RefreshCw } from 'lucide-react';

const EVENT_SLUG = 'sam-college-2026';
const BATCH_SIZE = 10;

export default function RegeneratePreviewsPage() {
  const [code, setCode] = useState('');
  const [running, setRunning] = useState(false);
  const [processed, setProcessed] = useState(0);
  const [total, setTotal] = useState(0);
  const [message, setMessage] = useState('Enter your admin code and start the backfill.');
  const [error, setError] = useState('');
  const inputRef = useRef(null);
  const autoStartedRef = useRef(false);

  const regenerateAll = async (accessCode = code) => {
    if (!accessCode || running) return;
    setRunning(true);
    setProcessed(0);
    setTotal(0);
    setError('');
    setMessage('Starting preview regeneration…');

    let offset = 0;
    let localTotal = 0;
    let localProcessed = 0;

    try {
      while (true) {
        const res = await fetch('/api/admin/regenerate-previews', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-admin-code': accessCode },
          body: JSON.stringify({ eventSlug: EVENT_SLUG, limit: BATCH_SIZE, offset }),
        });

        const text = await res.text();
        let body;
        try { body = JSON.parse(text); } catch { throw new Error(text.slice(0, 180) || `Server error (${res.status})`); }
        if (!res.ok) throw new Error(body.error || 'Preview regeneration failed.');

        localTotal = Number(body.totalReady || 0);
        localProcessed += Number(body.processed || 0);
        offset = Number(body.nextOffset || offset);
        setTotal(localTotal);
        setProcessed(Math.min(localProcessed, localTotal));
        setMessage(`Regenerating previews… ${Math.min(localProcessed, localTotal)}/${localTotal}`);

        if (body.done || !body.processed || !body.nextOffset) break;
      }

      setMessage(`✓ Preview regeneration complete: ${Math.min(localProcessed, localTotal)}/${localTotal}`);
    } catch (err) {
      setError(err?.message || 'Preview regeneration failed.');
      setMessage(`Stopped at ${Math.min(localProcessed, localTotal)}/${localTotal || '?'} processed.`);
    } finally {
      setRunning(false);
    }
  };

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get('autostart') !== '1') return;
    const syncAndStart = () => {
      const value = inputRef.current?.value || '';
      if (!value || autoStartedRef.current) return;
      autoStartedRef.current = true;
      setCode(value);
      regenerateAll(value);
    };
    const timer = setTimeout(syncAndStart, 700);
    return () => clearTimeout(timer);
  }, []);

  const progress = total ? Math.min(100, (processed / total) * 100) : 0;

  return (
    <main style={{ minHeight: '100vh', background: '#10100f', color: '#f3f1eb', fontFamily: 'Arial, sans-serif' }}>
      <section style={{ maxWidth: 760, margin: '0 auto', padding: '90px 24px' }}>
        <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: '.16em', color: '#918d84' }}>SMF PHOTO MATCH · ADMIN TOOL</div>
        <h1 style={{ fontFamily: 'Georgia, serif', fontSize: 'clamp(42px,7vw,72px)', letterSpacing: '-.06em', margin: '12px 0 14px' }}>Regenerate previews.</h1>
        <p style={{ color: '#9d9990', lineHeight: 1.65, maxWidth: 650 }}>
          Rebuild the existing event previews from private originals using the current customer-preview rules: tiny JPEG, strong blur, and centered <b>SMF PHOTO MATCH</b> watermark. Originals are not modified.
        </p>

        <div style={{ marginTop: 32, padding: 24, border: '1px solid #373632', borderRadius: 18, background: '#171715' }}>
          <label style={{ display: 'block', fontSize: 10, letterSpacing: '.12em', color: '#77736b', marginBottom: 8 }}>ADMIN ACCESS CODE</label>
          <input
            ref={inputRef}
            type="password"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            placeholder="Enter admin code"
            autoComplete="current-password"
            disabled={running}
            style={{ width: '100%', boxSizing: 'border-box', background: '#242420', color: '#fff', border: '1px solid #45443f', borderRadius: 10, padding: 14, outline: 'none' }}
          />

          <button
            onClick={() => regenerateAll()}
            disabled={!code || running}
            style={{ marginTop: 14, width: '100%', background: '#f3f1eb', color: '#111', border: 0, borderRadius: 10, padding: 14, fontWeight: 800, cursor: running ? 'wait' : 'pointer', opacity: !code || running ? .45 : 1 }}
          >
            {running ? <><Loader2 size={17} className="spin" style={{ verticalAlign: '-3px', marginRight: 7 }}/> Regenerating…</> : <><RefreshCw size={17} style={{ verticalAlign: '-3px', marginRight: 7 }}/> Regenerate all previews <ArrowRight size={17} style={{ verticalAlign: '-3px', marginLeft: 7 }}/></>}
          </button>

          <div style={{ marginTop: 18, color: '#aaa69d', fontSize: 12 }}>{message}</div>
          {total > 0 && <div style={{ marginTop: 12, height: 7, borderRadius: 99, background: '#2b2b28', overflow: 'hidden' }}><div style={{ height: '100%', width: `${progress}%`, background: '#e5e0d6', transition: 'width .2s ease' }}/></div>}
          {total > 0 && <div style={{ marginTop: 8, color: '#77736b', fontSize: 10 }}>{processed} / {total} previews regenerated</div>}
          {error && <div style={{ marginTop: 14, color: '#ffaaa5', fontSize: 12 }}>{error}</div>}
          {!running && !error && processed > 0 && processed === total && <div style={{ marginTop: 14, color: '#a9e4b4', fontSize: 12, display: 'flex', gap: 7, alignItems: 'center' }}><CheckCircle2 size={16}/> All existing previews have been replaced.</div>}
        </div>

        <div style={{ marginTop: 18, fontSize: 11, color: '#68655f', lineHeight: 1.6 }}>
          Event: <b style={{ color: '#aaa69d' }}>{EVENT_SLUG}</b><br/>
          Batch size: {BATCH_SIZE} photos<br/>
          Original files remain private and unchanged.
        </div>
      </section>
    </main>
  );
}
