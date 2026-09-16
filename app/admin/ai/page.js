'use client';

import { useRef, useState } from 'react';

const EVENT_SLUG = 'sam-college-2026';
const BATCH_SIZE = 25;

export default function AIIndexPage() {
  const [code, setCode] = useState('');
  const [running, setRunning] = useState(false);
  const [status, setStatus] = useState('');
  const [progress, setProgress] = useState({ done: 0, total: 0, indexed: 0, failed: 0, faces: 0 });
  const stopRef = useRef(false);

  const buildIndex = async () => {
    if (!code || running) return;
    stopRef.current = false;
    setRunning(true);
    setStatus('Starting Amazon Rekognition face index…');
    setProgress({ done: 0, total: 0, indexed: 0, failed: 0, faces: 0 });

    let total = 0;
    let indexed = 0;
    let failed = 0;
    let faces = 0;
    let lastDone = 0;

    try {
      while (!stopRef.current) {
        const res = await fetch('/api/admin/rekognition-index', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-admin-code': code },
          body: JSON.stringify({ eventSlug: EVENT_SLUG, limit: BATCH_SIZE }),
          cache: 'no-store',
        });
        const body = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(body.error || 'Could not build face index.');

        total = Number(body.totalReady || total);
        indexed += Number(body.indexedPhotos || 0);
        failed += Number(body.failedPhotos || 0);
        faces += Number(body.indexedFaces || 0);
        const donePhotos = Number(body.indexedTotal || lastDone);
        lastDone = donePhotos;
        setProgress({ done: donePhotos, total, indexed, failed, faces });

        setStatus(body.done
          ? `✓ AI index ready. ${donePhotos}/${total} photos, ${faces} faces indexed${failed ? `, ${failed} photo errors.` : '.'}`
          : `Indexing event photos… ${donePhotos}/${total}`);

        if (body.done || Number(body.batchSize || 0) === 0) break;
      }
    } catch (error) {
      setStatus(`Indexing failed: ${error?.message || 'Unknown error'}`);
    } finally {
      setRunning(false);
    }
  };

  const stop = () => {
    stopRef.current = true;
    setStatus('Stopping after the current batch…');
  };

  const pct = progress.total ? Math.min(100, (progress.done / progress.total) * 100) : 0;

  return (
    <main style={{ minHeight: '100vh', background: '#11110f', color: '#f3f1eb', fontFamily: 'Arial, sans-serif', padding: '48px 24px' }}>
      <div style={{ maxWidth: 760, margin: '0 auto' }}>
        <a href="/admin" style={{ color: '#aaa69d', textDecoration: 'none', fontSize: 12 }}>← Back to admin</a>
        <div style={{ marginTop: 28, color: '#979288', fontSize: 11, fontWeight: 700, letterSpacing: '.15em' }}>SMF PHOTO MATCH · AI</div>
        <h1 style={{ fontFamily: 'Georgia, serif', fontSize: 'clamp(40px,7vw,64px)', letterSpacing: '-.06em', margin: '10px 0 14px' }}>Build face index.</h1>
        <p style={{ color: '#aaa69d', lineHeight: 1.6, maxWidth: 650 }}>The index is incremental. New uploads are added without re-processing the entire event, so 500–1,000+ photo galleries remain practical.</p>

        <section style={{ marginTop: 28, padding: 22, borderRadius: 16, border: '1px solid #383834', background: '#171715' }}>
          <label style={{ display: 'block', color: '#aaa69d', fontSize: 11, marginBottom: 8 }}>ADMIN ACCESS CODE</label>
          <input type="password" value={code} onChange={(e) => setCode(e.target.value)} placeholder="Enter admin access code" style={{ width: '100%', boxSizing: 'border-box', padding: 13, borderRadius: 9, border: '1px solid #46453f', background: '#232320', color: '#fff', outline: 'none' }} />

          <div style={{ marginTop: 20, height: 10, background: '#2b2b27', borderRadius: 99, overflow: 'hidden' }}>
            <div style={{ width: `${pct}%`, height: '100%', background: '#b9b5ab', transition: 'width .25s ease' }} />
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 9, color: '#88857e', fontSize: 11 }}><span>{progress.done}/{progress.total || '—'} photos</span><span>{Math.round(pct)}%</span></div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8, marginTop: 16 }}>
            <Stat label="PHOTOS READY" value={progress.done}/>
            <Stat label="FACES INDEXED" value={progress.faces}/>
            <Stat label="PHOTO ERRORS" value={progress.failed}/>
            <Stat label="BATCH" value={BATCH_SIZE}/>
          </div>

          <div style={{ display: 'flex', gap: 9, marginTop: 20 }}>
            {!running ? <button onClick={buildIndex} disabled={!code} style={{ flex: 1, padding: 13, border: 0, borderRadius: 9, background: '#f3f1eb', color: '#111', fontWeight: 800, cursor: !code ? 'not-allowed' : 'pointer', opacity: !code ? .45 : 1 }}>Build / Continue AI Index</button> : <button onClick={stop} style={{ flex: 1, padding: 13, borderRadius: 9, border: '1px solid #57564f', background: '#24241f', color: '#f3f1eb', fontWeight: 700, cursor: 'pointer' }}>Stop after current batch</button>}
          </div>
          {status && <div style={{ marginTop: 15, color: status.startsWith('Indexing failed') ? '#ffaaa5' : '#a9e4b4', fontSize: 12, lineHeight: 1.55 }}>{status}</div>}
        </section>

        <div style={{ marginTop: 16, color: '#77746d', fontSize: 11, lineHeight: 1.6 }}>Run this after uploads. Re-running is safe: only photos that are still missing an AI index entry are processed.</div>
      </div>
    </main>
  );
}

function Stat({ label, value }) {
  return <div style={{ padding: 12, border: '1px solid #34342f', borderRadius: 9, background: '#1d1d1a' }}><div style={{ color: '#77746d', fontSize: 9, letterSpacing: '.08em' }}>{label}</div><div style={{ marginTop: 5, fontSize: 17, fontWeight: 800 }}>{value}</div></div>;
}
