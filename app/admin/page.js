'use client';

import { useRef, useState } from 'react';
import { ArrowRight, CheckCircle2, ImagePlus, Lock, Loader2, Upload } from 'lucide-react';
import { getSupabaseBrowser } from '../../lib/supabase-browser';

const EVENT_SLUG = 'sam-college-2026';
const MAX_BATCH = 500;
const REQUEST_CHUNK = 25;

export default function AdminUploadPage() {
  const inputRef = useRef(null);
  const [code, setCode] = useState('');
  const [files, setFiles] = useState([]);
  const [status, setStatus] = useState('');
  const [busy, setBusy] = useState(false);

  const upload = async () => {
    if (!code || !files.length || busy) return;
    setBusy(true);
    const selected = files.slice(0, MAX_BATCH);
    const uploaded = [];
    try {
      for (let offset = 0; offset < selected.length; offset += REQUEST_CHUNK) {
        const chunk = selected.slice(offset, offset + REQUEST_CHUNK);
        setStatus(`Preparing photos ${offset + 1}-${Math.min(offset + REQUEST_CHUNK, selected.length)} of ${selected.length}…`);
        const urlRes = await fetch('/api/admin/upload-url', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-admin-code': code },
          body: JSON.stringify({ eventSlug: EVENT_SLUG, files: chunk.map((f) => ({ name: f.name, type: f.type, size: f.size })) }),
        });
        const urlText = await urlRes.text();
        let urlBody;
        try { urlBody = JSON.parse(urlText); } catch { throw new Error(urlText.slice(0, 180) || `Server error (${urlRes.status})`); }
        if (!urlRes.ok) throw new Error(urlBody.error || 'Could not prepare upload.');

        const supabase = getSupabaseBrowser();
        for (let i = 0; i < chunk.length; i++) {
          const file = chunk[i];
          const u = urlBody.uploads[i];
          const overallIndex = offset + i + 1;
          setStatus(`Uploading ${overallIndex}/${selected.length}: ${file.name}`);
          const original = await supabase.storage.from('fm-originals').uploadToSignedUrl(u.originalPath, u.originalToken, file, { contentType: file.type || 'image/jpeg' });
          if (original.error) throw original.error;
          const previewFile = await makePreview(file);
          const preview = await supabase.storage.from('fm-previews').uploadToSignedUrl(u.previewPath, u.previewToken, previewFile, { contentType: 'image/jpeg' });
          if (preview.error) throw preview.error;
          uploaded.push({ name: u.name, originalPath: u.originalPath, previewPath: u.previewPath });
        }
      }

      setStatus(`Finalizing ${uploaded.length} photos…`);
      const finalRes = await fetch('/api/admin/upload-finalize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-admin-code': code },
        body: JSON.stringify({ eventSlug: EVENT_SLUG, uploads: uploaded }),
      });
      const finalText = await finalRes.text();
      let finalBody;
      try { finalBody = JSON.parse(finalText); } catch { throw new Error(finalText.slice(0, 180) || `Finalize error (${finalRes.status})`); }
      if (!finalRes.ok) throw new Error(finalBody.error || 'Could not finalize upload.');
      setStatus(`✓ ${finalBody.count} photos uploaded successfully.`);
      setFiles([]);
      if (inputRef.current) inputRef.current.value = '';
    } catch (error) {
      setStatus(`Upload failed: ${error?.message || 'Unknown error'}`);
    } finally {
      setBusy(false);
    }
  };

  return <main style={{ minHeight: '100vh', background: '#f7f6f2', color: '#161616', fontFamily: 'Arial, sans-serif' }}>
    <header style={{ height: 74, borderBottom: '1px solid #e5e2da', display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 5vw', background: '#faf9f6' }}>
      <div style={{ fontWeight: 800, letterSpacing: '.08em' }}>SMF PHOTO MATCH <span style={{ fontWeight: 500, color: '#8a867f' }}>ADMIN</span></div>
      <a href="/" style={{ color: '#555', fontSize: 13, textDecoration: 'none' }}>Customer view →</a>
    </header>
    <section style={{ maxWidth: 1000, margin: '0 auto', padding: '70px 24px' }}>
      <div style={{ color: '#89857d', fontSize: 11, fontWeight: 700, letterSpacing: '.15em' }}>SAM COLLEGE · PHOTO DELIVERY</div>
      <h1 style={{ fontSize: 'clamp(42px,6vw,68px)', letterSpacing: '-.06em', margin: '10px 0 12px' }}>Upload event originals.</h1>
      <p style={{ maxWidth: 650, color: '#777', lineHeight: 1.6 }}>Large files upload directly to Supabase Storage. Select up to 500 photos in one batch; uploads are prepared in small chunks for reliability, and a clear low-resolution preview is generated in your browser for face matching.</p>
      <div style={{ marginTop: 30, background: '#171717', color: '#fff', borderRadius: 20, padding: 24 }}>
        <label style={{ display: 'flex', alignItems: 'center', gap: 10, background: '#242424', borderRadius: 10, padding: '12px 14px' }}><Lock size={16}/><input type="password" value={code} onChange={(e) => setCode(e.target.value)} placeholder="Admin access code" style={{ flex: 1, background: 'transparent', color: '#fff', border: 0, outline: 0 }} /></label>
        <div style={{ marginTop: 18, border: '1px dashed #555', borderRadius: 15, padding: 28, textAlign: 'center' }}>
          <div style={{ width: 58, height: 58, borderRadius: 14, background: '#2a2a2a', display: 'grid', placeItems: 'center', margin: '0 auto 14px' }}><ImagePlus size={28}/></div>
          <input ref={inputRef} hidden type="file" multiple accept="image/jpeg,image/png,image/webp" onChange={(e) => setFiles(Array.from(e.target.files || []).slice(0, MAX_BATCH))}/>
          <button onClick={() => inputRef.current?.click()} style={{ background: '#fff', color: '#111', border: 0, borderRadius: 9, padding: '11px 15px', fontWeight: 700, cursor: 'pointer' }}><Upload size={16} style={{ verticalAlign: '-3px', marginRight: 7 }}/> Choose photos</button>
          <div style={{ marginTop: 12, color: '#aaa', fontSize: 12 }}>{files.length ? `${files.length} files selected${files.length >= MAX_BATCH ? ' (maximum)' : ''}` : 'Select up to 500 photos per batch'}</div>
        </div>
        {files.length > 0 && <button disabled={!code || busy} onClick={upload} style={{ marginTop: 16, width: '100%', background: '#fff', color: '#111', border: 0, borderRadius: 10, padding: 14, fontWeight: 800, cursor: busy ? 'wait' : 'pointer', opacity: !code || busy ? .45 : 1 }}>{busy ? <><Loader2 size={17} className="spin"/> Uploading…</> : <>Upload {Math.min(files.length, MAX_BATCH)} photos <ArrowRight size={17}/></>}</button>}
        {status && <div style={{ marginTop: 15, fontSize: 12, color: status.startsWith('Upload failed') ? '#ff9d9d' : '#a9e4b4', display: 'flex', gap: 7, alignItems: 'center' }}>{!status.startsWith('Upload failed') && <CheckCircle2 size={16}/>} {status}</div>}
      </div>
    </section>
  </main>;
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
