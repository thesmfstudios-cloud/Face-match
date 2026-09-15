'use client';

import { useRef, useState } from 'react';
import { ArrowRight, CheckCircle2, FolderOpen, HardDrive, ImagePlus, Lock, Loader2, RefreshCw, Upload } from 'lucide-react';
import { getSupabaseBrowser } from '../../lib/supabase-browser';

const EVENT_SLUG = 'sam-college-2026';
const MAX_BATCH = 500;
const REQUEST_CHUNK = 20;

export default function AdminUploadPage() {
  const inputRef = useRef(null);
  const [code, setCode] = useState('');
  const [files, setFiles] = useState([]);
  const [status, setStatus] = useState('');
  const [busy, setBusy] = useState(false);
  const [library, setLibrary] = useState(null);
  const [loadingLibrary, setLoadingLibrary] = useState(false);

  const loadLibrary = async () => {
    if (!code || loadingLibrary) return;
    setLoadingLibrary(true);
    try {
      const res = await fetch(`/api/admin/library?eventSlug=${encodeURIComponent(EVENT_SLUG)}`, {
        headers: { 'x-admin-code': code },
        cache: 'no-store',
      });
      const text = await res.text();
      let body;
      try { body = JSON.parse(text); } catch { throw new Error(text.slice(0, 180) || `Library error (${res.status})`); }
      if (!res.ok) throw new Error(body.error || 'Could not load photo library.');
      setLibrary(body);
    } catch (error) {
      setStatus(`Library failed: ${error?.message || 'Unknown error'}`);
    } finally {
      setLoadingLibrary(false);
    }
  };

  const upload = async () => {
    if (!code || !files.length || busy) return;
    setBusy(true);
    const selected = files.slice(0, MAX_BATCH);
    const uploaded = [];
    let skippedCount = 0;
    try {
      setStatus(`Checking ${selected.length} photos for duplicates…`);
      const prepared = [];
      for (let i = 0; i < selected.length; i++) {
        const file = selected[i];
        setStatus(`Checking ${i + 1}/${selected.length}: ${file.name}`);
        prepared.push({ file, hash: await sha256(file) });
      }

      const seen = new Set();
      const uniquePrepared = [];
      for (const item of prepared) {
        if (seen.has(item.hash)) {
          skippedCount += 1;
          continue;
        }
        seen.add(item.hash);
        uniquePrepared.push(item);
      }

      for (let offset = 0; offset < uniquePrepared.length; offset += REQUEST_CHUNK) {
        const chunk = uniquePrepared.slice(offset, offset + REQUEST_CHUNK);
        setStatus(`Preparing photos ${offset + 1}-${Math.min(offset + REQUEST_CHUNK, uniquePrepared.length)} of ${uniquePrepared.length}…`);
        const urlRes = await fetch('/api/admin/upload-url', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-admin-code': code },
          body: JSON.stringify({
            eventSlug: EVENT_SLUG,
            files: chunk.map((item, index) => ({ name: item.file.name, type: item.file.type, size: item.file.size, hash: item.hash, index })),
          }),
        });
        const urlText = await urlRes.text();
        let urlBody;
        try { urlBody = JSON.parse(urlText); } catch { throw new Error(urlText.slice(0, 180) || `Server error (${urlRes.status})`); }
        if (!urlRes.ok) throw new Error(urlBody.error || 'Could not prepare upload.');
        if (!Array.isArray(urlBody.uploads)) throw new Error('Upload preparation returned an invalid response.');
        skippedCount += Array.isArray(urlBody.skipped) ? urlBody.skipped.length : 0;

        const supabase = getSupabaseBrowser();
        for (const u of urlBody.uploads) {
          const item = chunk[u.index];
          if (!item) throw new Error('Upload preparation returned an invalid file index.');
          const overallIndex = offset + u.index + 1;
          setStatus(`Uploading ${overallIndex}/${uniquePrepared.length}: ${item.file.name}`);
          const original = await supabase.storage.from('fm-originals').uploadToSignedUrl(u.originalPath, u.originalToken, item.file, { contentType: item.file.type || 'image/jpeg' });
          if (original.error) throw original.error;
          const previewFile = await makePreview(item.file);
          const preview = await supabase.storage.from('fm-previews').uploadToSignedUrl(u.previewPath, u.previewToken, previewFile, { contentType: 'image/jpeg' });
          if (preview.error) throw preview.error;
          uploaded.push({ name: u.name, fileHash: u.fileHash || item.hash, originalPath: u.originalPath, previewPath: u.previewPath });
        }
      }

      if (!uploaded.length) {
        setStatus(`✓ No new photos uploaded. ${skippedCount} duplicate photo${skippedCount === 1 ? '' : 's'} skipped automatically.`);
      } else {
        setStatus(`Finalizing ${uploaded.length} new photos…`);
        const finalRes = await fetch('/api/admin/upload-finalize', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-admin-code': code },
          body: JSON.stringify({ eventSlug: EVENT_SLUG, uploads: uploaded }),
        });
        const finalText = await finalRes.text();
        let finalBody;
        try { finalBody = JSON.parse(finalText); } catch { throw new Error(finalText.slice(0, 180) || `Finalize error (${finalRes.status})`); }
        if (!finalRes.ok) throw new Error(finalBody.error || 'Could not finalize upload.');
        setStatus(`✓ ${finalBody.count} new photos uploaded. ${skippedCount ? `${skippedCount} duplicate${skippedCount === 1 ? '' : 's'} skipped automatically.` : ''}`.trim());
      }
      setFiles([]);
      if (inputRef.current) inputRef.current.value = '';
      await loadLibrary();
    } catch (error) {
      setStatus(`Upload failed: ${error?.message || 'Unknown error'}`);
    } finally {
      setBusy(false);
    }
  };

  const formatBytes = (bytes) => {
    const n = Number(bytes || 0);
    if (!n) return '0 B';
    const units = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.min(Math.floor(Math.log(n) / Math.log(1024)), units.length - 1);
    return `${(n / (1024 ** i)).toFixed(i ? 1 : 0)} ${units[i]}`;
  };

  const storage = library?.storage;
  const usedPercent = storage?.quota_bytes ? Math.min(100, (storage.used_bytes / storage.quota_bytes) * 100) : null;

  return <main style={{ minHeight: '100vh', background: '#20201e', color: '#f3f1eb', fontFamily: 'Arial, sans-serif' }}>
    <header style={{ height: 74, borderBottom: '1px solid #393936', display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 5vw', background: '#252522' }}>
      <div style={{ fontWeight: 800, letterSpacing: '.08em' }}>SMF PHOTO MATCH <span style={{ fontWeight: 500, color: '#9f9b91' }}>ADMIN</span></div>
      <a href="/" style={{ color: '#c2beb4', fontSize: 13, textDecoration: 'none' }}>Customer view →</a>
    </header>

    <section style={{ maxWidth: 1120, margin: '0 auto', padding: '70px 24px 90px' }}>
      <div style={{ color: '#979288', fontSize: 11, fontWeight: 700, letterSpacing: '.15em' }}>SAM COLLEGE · PHOTO DELIVERY</div>
      <h1 style={{ fontFamily: 'Georgia, serif', fontSize: 'clamp(42px,6vw,68px)', letterSpacing: '-.06em', margin: '10px 0 12px', color: '#f3f1eb' }}>Upload event originals.</h1>
      <p style={{ maxWidth: 700, color: '#aaa69d', lineHeight: 1.6 }}>Large files upload directly to Supabase Storage. Select up to 500 photos in one batch; exact duplicates are skipped automatically, uploads run in small chunks for reliability, and a clear low-resolution preview is generated for face matching.</p>

      <div style={{ marginTop: 30, background: '#151513', color: '#fff', borderRadius: 18, padding: 24, border: '1px solid #393936' }}>
        <label style={{ display: 'flex', alignItems: 'center', gap: 10, background: '#2a2a27', borderRadius: 10, padding: '12px 14px' }}><Lock size={16}/><input type="password" value={code} onChange={(e) => setCode(e.target.value)} placeholder="Admin access code" style={{ flex: 1, background: 'transparent', color: '#fff', border: 0, outline: 0 }} /></label>
        <div style={{ marginTop: 18, border: '1px dashed #5b5a55', borderRadius: 15, padding: 28, textAlign: 'center', background: '#191917' }}>
          <div style={{ width: 58, height: 58, borderRadius: 14, background: '#2b2b28', display: 'grid', placeItems: 'center', margin: '0 auto 14px' }}><ImagePlus size={28}/></div>
          <input ref={inputRef} hidden type="file" multiple accept="image/jpeg,image/png,image/webp" onChange={(e) => setFiles(Array.from(e.target.files || []).slice(0, MAX_BATCH))}/>
          <button onClick={() => inputRef.current?.click()} style={{ background: '#f3f1eb', color: '#111', border: 0, borderRadius: 9, padding: '11px 15px', fontWeight: 700, cursor: 'pointer' }}><Upload size={16} style={{ verticalAlign: '-3px', marginRight: 7 }}/> Choose photos</button>
          <div style={{ marginTop: 12, color: '#aaa69d', fontSize: 12 }}>{files.length ? `${files.length} files selected${files.length >= MAX_BATCH ? ' (maximum)' : ''}` : 'Select up to 500 photos per batch'}</div>
        </div>
        {files.length > 0 && <button disabled={!code || busy} onClick={upload} style={{ marginTop: 16, width: '100%', background: '#f3f1eb', color: '#111', border: 0, borderRadius: 10, padding: 14, fontWeight: 800, cursor: busy ? 'wait' : 'pointer', opacity: !code || busy ? .45 : 1 }}>{busy ? <><Loader2 size={17} className="spin"/> Working…</> : <>Upload {Math.min(files.length, MAX_BATCH)} photos <ArrowRight size={17}/></>}</button>}
        {status && <div style={{ marginTop: 15, fontSize: 12, color: status.startsWith('Upload failed') || status.startsWith('Library failed') ? '#ffaaa5' : '#a9e4b4', display: 'flex', gap: 7, alignItems: 'flex-start' }}>{!(status.startsWith('Upload failed') || status.startsWith('Library failed')) && <CheckCircle2 size={16}/>} <span>{status}</span></div>}
      </div>

      <section style={{ marginTop: 18, background: '#151513', border: '1px solid #393936', borderRadius: 18, padding: 24 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 16, alignItems: 'flex-start', flexWrap: 'wrap' }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontWeight: 800, fontSize: 15 }}><FolderOpen size={17}/> Photo library</div>
            <p style={{ margin: '7px 0 0', color: '#969289', fontSize: 11, lineHeight: 1.55 }}>All uploaded photos for this event, shown as clear previews. Originals remain private and are never exposed to customers.</p>
          </div>
          <button disabled={!code || loadingLibrary} onClick={loadLibrary} style={{ background: '#252522', color: '#ddd9d0', border: '1px solid #44433f', borderRadius: 8, padding: '9px 12px', fontSize: 10, display: 'flex', alignItems: 'center', gap: 7, cursor: 'pointer', opacity: !code || loadingLibrary ? .5 : 1 }}>{loadingLibrary ? <Loader2 size={15} className="spin"/> : <RefreshCw size={15}/>} Refresh library</button>
        </div>

        {!library ? <div style={{ padding: '30px 0', textAlign: 'center', color: '#78756e', fontSize: 10 }}>Enter the admin access code to load the photo folder, previews, and storage usage.</div> : <>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', border: '1px solid #33322f', borderRadius: 10, overflow: 'hidden', marginTop: 18 }}>
            <LibraryStat label="PHOTOS" value={library.photos?.length || 0} detail={library.event?.name || EVENT_SLUG}/>
            <LibraryStat label="ORIGINAL STORAGE" value={formatBytes(storage?.originals?.bytes)} detail={`${storage?.originals?.count || 0} private files`}/>
            <LibraryStat label="PREVIEW STORAGE" value={formatBytes(storage?.previews?.bytes)} detail={`${storage?.previews?.count || 0} preview files`}/>
            <LibraryStat label="SPACE REMAINING" value={storage?.quota_configured ? formatBytes(storage.remaining_bytes) : 'Not set'} detail={storage?.quota_configured ? `${usedPercent.toFixed(1)}% of quota used` : 'Set SUPABASE_STORAGE_LIMIT_GB'}/>
          </div>

          {storage?.quota_configured && <div style={{ marginTop: 14, padding: 12, border: '1px solid #33322f', borderRadius: 10, background: '#1b1b19' }}><div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, fontSize: 9, color: '#918e86', marginBottom: 8 }}><b style={{ color: '#ddd9d0' }}>Total storage</b><span>{formatBytes(storage.used_bytes)} / {formatBytes(storage.quota_bytes)}</span></div><div style={{ height: 6, borderRadius: 999, background: '#2c2c28', overflow: 'hidden' }}><div style={{ width: `${usedPercent}%`, height: '100%', background: '#e3dfd7' }}/></div></div>}

          <div style={{ marginTop: 16, border: '1px solid #33322f', borderRadius: 10, overflow: 'hidden' }}>
            <div style={{ padding: 12, background: '#1c1c1a', display: 'flex', alignItems: 'center', gap: 9 }}><FolderOpen size={16}/><div><div style={{ fontSize: 10, fontWeight: 800 }}>{EVENT_SLUG}</div><div style={{ fontSize: 8, color: '#78756e', marginTop: 3 }}>Originals + previews</div></div></div>
            {library.photos?.length ? <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 9, padding: 10, background: '#10100f' }}>{library.photos.map((photo) => <div key={photo.id} style={{ border: '1px solid #2d2c29', background: '#151513', overflow: 'hidden', borderRadius: 6 }}><div style={{ position: 'relative', aspectRatio: '1 / 1', background: '#0a0a09' }}>{photo.preview_url ? <img src={photo.preview_url} alt={photo.original_filename || 'Event photo'} loading="lazy" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}/> : <div style={{ height: '100%', display: 'grid', placeItems: 'center', color: '#666', fontSize: 9 }}>No preview</div>}<span style={{ position: 'absolute', top: 7, right: 7, background: 'rgba(0,0,0,.72)', border: '1px solid #4a4843', color: '#fff', fontSize: 8, fontWeight: 700, borderRadius: 4, padding: '4px 6px' }}>₹{photo.price}</span></div><div style={{ padding: 9 }}><div title={photo.original_filename} style={{ fontSize: 9, fontWeight: 700, color: '#eeeae2', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{photo.original_filename}</div><div style={{ marginTop: 4, fontSize: 8, color: '#77746d' }}>{photo.people_count || 1} {Number(photo.people_count || 1) === 1 ? 'person' : 'people'} · {photo.processing_status}</div></div></div>)}</div> : <div style={{ padding: 30, textAlign: 'center', color: '#77746d', fontSize: 10 }}>No photos in this event folder yet.</div>}
          </div>
        </>}
      </section>
    </section>
  </main>;
}

function LibraryStat({ label, value, detail }) {
  return <div style={{ padding: 15, borderRight: '1px solid #33322f', background: '#11110f', minWidth: 0 }}><div style={{ fontSize: 8, letterSpacing: '.14em', color: '#77746d', display: 'flex', alignItems: 'center', gap: 5 }}>{label === 'SPACE REMAINING' && <HardDrive size={12}/>} {label}</div><div style={{ marginTop: 6, fontSize: 17, fontWeight: 800, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{value}</div><div style={{ marginTop: 4, fontSize: 8, color: '#77746d', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{detail}</div></div>;
}

async function sha256(file) {
  const buffer = await file.arrayBuffer();
  const digest = await crypto.subtle.digest('SHA-256', buffer);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

function makePreview(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = async () => {
      URL.revokeObjectURL(url);
      const MAX_BYTES = 800 * 1024;
      const TARGET_BYTES = 650 * 1024;
      let max = 1400;
      let quality = 0.84;
      let blob = null;
      try {
        for (let attempt = 0; attempt < 12; attempt++) {
          const scale = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
          const canvas = document.createElement('canvas');
          canvas.width = Math.max(1, Math.round(img.naturalWidth * scale));
          canvas.height = Math.max(1, Math.round(img.naturalHeight * scale));
          const ctx = canvas.getContext('2d', { alpha: false });
          ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
          blob = await new Promise((r) => canvas.toBlob(r, 'image/jpeg', quality));
          if (!blob) throw new Error('Could not create preview.');
          if (blob.size <= TARGET_BYTES) break;
          if (blob.size > MAX_BYTES) {
            quality = Math.max(0.50, quality - 0.07);
            if (quality <= 0.57) max = Math.max(900, Math.round(max * 0.88));
          } else break;
        }
        resolve(blob);
      } catch (error) {
        reject(error);
      }
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Could not read image.')); };
    img.src = url;
  });
}
