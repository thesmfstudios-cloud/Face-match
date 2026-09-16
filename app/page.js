'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowRight, Camera, Check, CheckCircle2, IndianRupee, Lock, Search, ShieldCheck, Sparkles, Upload, X, Loader2, Video } from 'lucide-react';
import { getSupabaseBrowser } from '../lib/supabase-browser';

const EVENT_SLUG = 'sam-college-2026';
const INDEX_RETRY_DELAY = 3000;
const MAX_INDEX_RETRIES = 30;
const PAID_ORDER_STORAGE_KEY = `fm_paid_order_${EVENT_SLUG}`;
const RECOVERY_WINDOW_MS = 45 * 60 * 1000;

// Treat a selection as already-paid only when it contains exactly the same
// photo IDs as the last approved order. A different selection requires a
// fresh payment.
function sameSelection(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
  const aa = [...new Set(a.map(String))].sort();
  const bb = [...new Set(b.map(String))].sort();
  return aa.length === bb.length && aa.every((id, i) => id === bb[i]);
}

export default function Home() {
  const [mode, setMode] = useState('customer');
  const [event, setEvent] = useState(null);
  const [photos, setPhotos] = useState([]);
  const [selfie, setSelfie] = useState(null);
  const [selfieName, setSelfieName] = useState('');
  const [matched, setMatched] = useState(false);
  const [matching, setMatching] = useState(false);
  const [matchMessage, setMatchMessage] = useState('');
  const [selected, setSelected] = useState([]);
  const [paymentOpen, setPaymentOpen] = useState(false);
  const [paymentSent, setPaymentSent] = useState(false);
  const [paymentLoading, setPaymentLoading] = useState(false);
  const [orderId, setOrderId] = useState('');
  const [dataError, setDataError] = useState('');
  const [cameraOpen, setCameraOpen] = useState(false);
  const videoRef = useRef(null);
  const cameraStreamRef = useRef(null);
  const [downloadStarting, setDownloadStarting] = useState(false);
  const [downloadStarted, setDownloadStarted] = useState(false);
  const [downloadAttempted, setDownloadAttempted] = useState(false);
  const [staleOrder, setStaleOrder] = useState(null);
  const downloadLockRef = useRef(false);
  const [activePaidOrderId, setActivePaidOrderId] = useState('');
  const [activePaidPhotoIds, setActivePaidPhotoIds] = useState([]);

  const livePhotos = photos;
  const total = useMemo(() => selected.reduce((sum, id) => {
    const p = livePhotos.find((x) => x.id === id);
    const people = Number(p?.people_count || 1);
    return sum + (people > 1 ? 15 : 5);
  }, 0), [selected, livePhotos]);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const supabase = getSupabaseBrowser();
        const { data: e, error: ee } = await supabase
          .from('fm_events')
          .select('id,name,event_date,photos_count,upi_id,status')
          .eq('slug', EVENT_SLUG)
          .eq('status', 'live')
          .single();
        if (ee) throw ee;

        const { data: p, error: pe } = await supabase
          .from('fm_photos')
          .select('id,preview_path,original_filename,people_count,price,processing_status')
          .eq('event_id', e.id)
          .eq('processing_status', 'ready')
          .order('created_at', { ascending: true });
        if (pe) throw pe;

        const mapped = (p || []).map((row) => ({
          ...row,
          preview_url: `${supabase.storage.from('fm-previews').getPublicUrl(row.preview_path).data.publicUrl}?v=${Date.now()}`,
        }));
        if (active) {
          setEvent(e);
          setPhotos(mapped);
        }
      } catch (err) {
        console.warn('Could not load live event:', err);
        if (active) setDataError('Unable to load the live gallery. Please refresh and try again.');
      }
    })();
    return () => { active = false; };
  }, []);

  const removeStoredOrder = () => {
    if (typeof window === 'undefined') return;
    try { window.localStorage.removeItem(PAID_ORDER_STORAGE_KEY); } catch {}
  };

  const rememberApprovedOrder = (approvedOrderId, photoIds) => {
    if (typeof window === 'undefined' || !approvedOrderId) return;
    const ids = Array.isArray(photoIds) ? photoIds.map(String) : [];
    setActivePaidOrderId(approvedOrderId);
    setActivePaidPhotoIds(ids);
    try {
      window.localStorage.setItem(PAID_ORDER_STORAGE_KEY, JSON.stringify({
        orderId: approvedOrderId,
        selectedPhotoIds: ids,
        savedAt: Date.now(),
      }));
    } catch {}
  };

  const hydrateApprovedOrder = async (savedOrderId, { silent = false } = {}) => {
    if (!savedOrderId) return false;
    try {
      const res = await fetch(`/api/orders/${encodeURIComponent(savedOrderId)}/status`, { cache: 'no-store' });
      const body = await res.json().catch(() => ({}));
      if (!res.ok || !body?.order) {
        if (res.status === 404) removeStoredOrder();
        return false;
      }

      const status = body.order.status;
      if (status === 'rejected') {
        removeStoredOrder();
        return false;
      }
      if (status !== 'approved' && status !== 'fulfilled') return false;

      const restoredIds = Array.isArray(body.order.selected_photo_ids)
        ? body.order.selected_photo_ids.map(String)
        : [];

      setOrderId(body.order.id);
      setPaymentSent(true);
      setPaymentLoading(false);
      setStaleOrder(null);
      setDownloadStarted(false);
      setDownloadAttempted(false);
      setActivePaidOrderId(body.order.id);
      setActivePaidPhotoIds(restoredIds);
      if (restoredIds.length) setSelected(restoredIds);
      if (!silent) {
        setMatchMessage(
          restoredIds.length
            ? `Payment already verified for ${restoredIds.length} photo${restoredIds.length === 1 ? '' : 's'}. Your originals are ready to download.`
            : 'Payment already verified. Your original photos are ready to download.'
        );
      }
      rememberApprovedOrder(body.order.id, restoredIds);
      return true;
    } catch (error) {
      console.warn('Could not recover paid order:', error);
      return false;
    }
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

        if (isRecent) {
          await hydrateApprovedOrder(saved.orderId);
          return;
        }

        if (!cancelled) setStaleOrder({ orderId: String(saved.orderId) });
      } catch (error) {
        console.warn('Could not recover paid order:', error);
      }
    };

    recoverPaidOrder();
    return () => { cancelled = true; };
  }, []);

  const stopCamera = () => {
    const stream = cameraStreamRef.current;
    if (stream) stream.getTracks().forEach((track) => track.stop());
    cameraStreamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
    setCameraOpen(false);
  };

  const startCamera = async () => {
    setMatchMessage('');
    try {
      if (!navigator.mediaDevices?.getUserMedia) throw new Error('Camera access is not supported in this browser.');
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 720 } },
        audio: false,
      });
      cameraStreamRef.current = stream;
      setCameraOpen(true);
      requestAnimationFrame(() => {
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          videoRef.current.play().catch(() => {});
        }
      });
    } catch (error) {
      setMatchMessage(error?.message || 'Could not open camera. Please allow camera permission.');
    }
  };

  const captureCameraSelfie = () => {
    const video = videoRef.current;
    if (!video || !video.videoWidth) return;
    const canvas = document.createElement('canvas');
    const max = 1280;
    const scale = Math.min(1, max / Math.max(video.videoWidth, video.videoHeight));
    canvas.width = Math.max(1, Math.round(video.videoWidth * scale));
    canvas.height = Math.max(1, Math.round(video.videoHeight * scale));
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    canvas.toBlob((blob) => {
      if (!blob) return;
      const file = new File([blob], `camera-selfie-${Date.now()}.jpg`, { type: 'image/jpeg' });
      setSelfie(file);
      setSelfieName('Camera selfie');
      setMatched(false);
      setMatchMessage('');
      setSelected([]);
      setPaymentSent(false);
      setOrderId('');
      setDownloadStarted(false);
      setDownloadAttempted(false);
      setDownloadStarting(false);
      stopCamera();
    }, 'image/jpeg', 0.9);
  };

  const chooseSelfie = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setSelfie(file);
    setSelfieName(file.name);
    setMatched(false);
    setMatchMessage('');
    setSelected([]);
    setPaymentSent(false);
    setOrderId('');
    setDownloadStarted(false);
    setDownloadAttempted(false);
    setDownloadStarting(false);
  };

  const notifyScanComplete = (count) => {
    if (typeof window === 'undefined' || !('Notification' in window) || Notification.permission !== 'granted') return;
    try {
      new Notification('SMF Photo Match', {
        body: count ? `${count} matching photos are ready to view.` : 'Your photo scan is complete.',
        icon: '/favicon.ico',
      });
    } catch {}
  };

  const runFaceMatch = async () => {
    if (!selfie || matching || !photos.length) {
      if (!photos.length && !dataError) setMatchMessage('The event gallery is still loading. Please try again in a moment.');
      return;
    }

    setMatching(true);
    setMatched(false);
    setSelected([]);
    setPaymentSent(false);
    setOrderId('');
    setDownloadStarted(false);
    setDownloadAttempted(false);
    setDownloadStarting(false);
    setMatchMessage('Finding your photos with AI…');

    try {
      let body = null;

      for (let attempt = 0; attempt <= MAX_INDEX_RETRIES; attempt += 1) {
        const form = new FormData();
        form.append('eventSlug', EVENT_SLUG);
        form.append('selfie', selfie);

        const response = await fetch('/api/face-match', {
          method: 'POST',
          body: form,
          cache: 'no-store',
        });
        body = await response.json().catch(() => ({}));

        if (response.ok && body.ok) break;

        if (response.status === 409 && body.status === 'indexing') {
          const done = Number(body.indexedPhotos || 0);
          const totalPhotos = Number(body.totalPhotos || 0);
          setMatchMessage(totalPhotos
            ? `Preparing the gallery for AI… ${done}/${totalPhotos} photos ready. This can continue automatically.`
            : 'Preparing the gallery for AI…');
          if (attempt >= MAX_INDEX_RETRIES) {
            throw new Error('The event gallery is still being prepared. Please try the scan again shortly.');
          }
          await new Promise((resolve) => setTimeout(resolve, INDEX_RETRY_DELAY));
          continue;
        }

        throw new Error(body.error || body.message || 'Face matching failed.');
      }

      const matchMap = new Map(
        (Array.isArray(body?.matches) ? body.matches : []).map((match) => [
          String(match.photoId),
          Number(match.similarity || 0),
        ])
      );

      const results = photos
        .filter((photo) => matchMap.has(String(photo.id)))
        .map((photo) => ({
          ...photo,
          match_similarity: matchMap.get(String(photo.id)),
          no_match: false,
        }));

      setMatched(true);
      setMatching(false);
      setMatchMessage(results.length
        ? `${results.length} matching photos found.`
        : 'No close face matches found. Try a clearer selfie or better lighting.');
      notifyScanComplete(results.length);

      const resultIds = new Set(results.map((r) => r.id));
      setPhotos((current) => current.map((photo) => (
        resultIds.has(photo.id)
          ? { ...photo, no_match: false, match_similarity: matchMap.get(String(photo.id)) }
          : { ...photo, no_match: true }
      )));
    } catch (error) {
      setMatching(false);
      setMatchMessage(error?.message || 'Face matching failed.');
    }
  };

  const toggle = (id) => setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));

  useEffect(() => {
    if (!selected.length) return;

    if (activePaidOrderId && sameSelection(selected, activePaidPhotoIds)) {
      setOrderId(activePaidOrderId);
      setPaymentSent(true);
      return;
    }

    if (paymentSent) {
      setPaymentSent(false);
      setOrderId('');
      setDownloadStarted(false);
      setDownloadAttempted(false);
      setDownloadStarting(false);
    }
    // Intentionally omit `paymentSent` to avoid an effect loop.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected, activePaidOrderId, activePaidPhotoIds]);

  const downloadApprovedPhotos = (approvedOrderId) => {
    if (!approvedOrderId || !selected.length || downloadLockRef.current) return false;

    downloadLockRef.current = true;
    setDownloadAttempted(true);
    setDownloadStarting(true);
    setMatchMessage('Preparing your original photo download…');

    try {
      // Native navigation avoids buffering the whole ZIP in browser memory
      // and works with attachment responses on desktop and mobile browsers.
      window.location.assign(`/api/orders/${encodeURIComponent(approvedOrderId)}/download-zip`);
      setMatchMessage('Your original photos are downloading. If it does not start, tap “Download Originals” again.');
      return true;
    } catch (error) {
      setMatchMessage(error?.message || 'Could not start the photo download. Use “Download Originals” to retry.');
      return false;
    } finally {
      window.setTimeout(() => {
        downloadLockRef.current = false;
        setDownloadStarting(false);
      }, 2500);
    }
  };

  const submitPayment = async () => {
    if (!selected.length || paymentLoading) return;
    setPaymentLoading(true);
    setPaymentOpen(false);
    setMatchMessage('Opening secure Razorpay checkout…');
    try {
      const scriptLoaded = await loadRazorpayScript();
      if (!scriptLoaded || !window.Razorpay) throw new Error('Razorpay checkout could not be loaded.');
      const createRes = await fetch('/api/create-order', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          eventSlug: EVENT_SLUG,
          selectedPhotoIds: selected,
          groupPhotoIds: selected.filter((id) => Number(livePhotos.find((p) => p.id === id)?.people_count || 1) > 1),
        }),
      });
      const createBody = await createRes.json();
      if (!createRes.ok) throw new Error(createBody.error || 'Could not create payment order.');
      if (!createBody.key_id) throw new Error('Razorpay key configuration is missing.');
      const options = {
        key: createBody.key_id,
        one_click_checkout: false,
        amount: createBody.amount,
        currency: createBody.currency,
        name: 'SMF Studios',
        description: `${selected.length} event photo${selected.length === 1 ? '' : 's'}`,
        order_id: createBody.order_id,
        handler: async (response) => {
          try {
            setMatchMessage('Verifying payment securely…');
            const verifyRes = await fetch('/api/verify-payment', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                eventSlug: EVENT_SLUG,
                selectedPhotoIds: selected,
                groupPhotoIds: selected.filter((id) => Number(livePhotos.find((p) => p.id === id)?.people_count || 1) > 1),
                razorpay_payment_id: response.razorpay_payment_id,
                razorpay_order_id: response.razorpay_order_id,
                razorpay_signature: response.razorpay_signature,
              }),
            });
            const verifyBody = await verifyRes.json();
            if (!verifyRes.ok || !verifyBody.ok) throw new Error(verifyBody.error || 'Payment verification failed.');
            const approvedId = verifyBody.order?.id;
            const paidSelection = [...selected].map(String);
            setOrderId(approvedId || '');
            setPaymentSent(true);
            setActivePaidOrderId(approvedId || '');
            setActivePaidPhotoIds(paidSelection);
            setDownloadStarted(false);
            setDownloadAttempted(false);
            setMatchMessage('Payment verified. Starting your original downloads…');
            setPaymentLoading(false);
            if (approvedId) {
              rememberApprovedOrder(approvedId, paidSelection);
              await downloadApprovedPhotos(approvedId);
            }
          } catch (error) {
            setPaymentLoading(false);
            setMatchMessage(error?.message || 'Payment verification failed.');
          }
        },
        modal: {
          backdropclose: false,
          ondismiss: () => {
            setPaymentLoading(false);
            setMatchMessage('Payment cancelled.');
          },
        },
        notes: { event: EVENT_SLUG },
        theme: { color: '#111111' },
      };
      const rzp = new window.Razorpay(options);
      rzp.on('payment.failed', (response) => {
        setPaymentLoading(false);
        setMatchMessage(response?.error?.description || 'Payment failed. Please try again.');
      });
      rzp.open();
    } catch (error) {
      setPaymentLoading(false);
      setMatchMessage(error?.message || 'Could not start Razorpay checkout.');
    }
  };

  useEffect(() => {
    if (!orderId || !paymentSent || downloadAttempted || !selected.length) return undefined;
    let cancelled = false;
    let timer;
    const check = async () => {
      try {
        const res = await fetch(`/api/orders/${encodeURIComponent(orderId)}/status`, { cache: 'no-store' });
        const body = await res.json();
        const status = body.order?.status;
        if (cancelled) return;
        if (status === 'approved' || status === 'fulfilled') {
          await downloadApprovedPhotos(orderId);
          return;
        }
        if (status === 'rejected') {
          setMatchMessage('Payment was not approved. Please contact the event photographer.');
          return;
        }
      } catch {}
      if (!cancelled) timer = setTimeout(check, 5000);
    };
    check();
    return () => { cancelled = true; clearTimeout(timer); };
  }, [orderId, paymentSent, downloadAttempted, selected]);

  const displayPhotos = matched ? photos.filter((p) => !p.no_match) : [];
  const eventName = event?.name || 'Event gallery';
  const photoCount = event?.photos_count || photos.length || 0;

  return <main className="shell">
    <header className="topbar">
      <div className="brand" onClick={() => setMode('customer')}><div className="brandMark">SMF</div><div><div className="brandName">PHOTO MATCH</div><div className="brandSub">SMART EVENT DELIVERY</div></div></div>
      <div className="topActions"><span className="secure"><ShieldCheck size={15}/> Private originals</span><div className="segmented"><button className={mode === 'customer' ? 'active' : ''} onClick={() => setMode('customer')}>Customer</button><button className="adminLinkButton" onClick={() => { window.location.href = '/admin'; }}>Admin</button></div></div>
    </header>

    {mode === 'customer' ? <>
      <section className="hero"><div className="eyebrowPill"><Sparkles size={14}/> AI PHOTO DELIVERY · {eventName.toUpperCase()}</div><h1>Find the moments<br/><em>you’re in.</em></h1><p className="heroCopy">Upload one clear selfie. We run face recognition against the event gallery and only show likely matches.</p><div className="eventBar"><div><span className="micro">EVENT</span><strong>{eventName}</strong></div><div className="eventMeta"><b>{photoCount}</b> photos indexed</div></div></section>

      <section className="finderCard"><div className="finderIcon"><Camera size={28}/></div><div className="finderBody"><div className="finderTitle">Find my photos</div><div className="finderHint">Use a front-facing selfie or camera capture with your face clearly visible.</div><input id="selfie" hidden type="file" accept="image/jpeg,image/png,image/webp,.jpg,.jpeg,.png,.webp" onChange={chooseSelfie}/><div className="finderControls"><label className="uploadButton" htmlFor="selfie">{selfie ? <><CheckCircle2 size={17}/> {selfieName}</> : <><Upload size={17}/> Upload photo</>}</label><button type="button" className="cameraButton" onClick={startCamera}><Video size={17}/> Use camera</button></div></div><button className="primaryButton" disabled={!selfie || matching || !photos.length} onClick={runFaceMatch}>{matching ? <><Loader2 size={17} className="spin"/> Matching…</> : <>Find photos <ArrowRight size={17}/></>}</button></section>

      {dataError && <div className="notice">{dataError}</div>}
      {matchMessage && <div className={`notice ${matchMessage.includes('found') ? 'successNotice' : ''}`}>{matchMessage}</div>}
      {paymentSent && <div className="notice successNotice"><CheckCircle2 size={17}/> Payment verified successfully. Your original downloads are ready.{orderId && <> Order: <code>{orderId}</code></>}</div>}
      {paymentSent && orderId && <div className="notice downloadRecoveryNotice" style={{ justifyContent: 'space-between', flexWrap: 'wrap', gap: 14, padding: '16px 18px' }}><div style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0, flex: 1 }}><b>Originals ready</b><span>Your payment is already verified. You can retry the download anytime without paying again.</span></div><button type="button" className="primaryButton" style={{ whiteSpace: 'nowrap', flexShrink: 0 }} onClick={() => downloadApprovedPhotos(orderId)} disabled={downloadStarting || !selected.length}>{downloadStarting ? <><Loader2 size={17} className="spin"/> Preparing…</> : <>Download Originals <ArrowRight size={17}/></>}</button></div>}
      {!paymentSent && staleOrder && <div className="notice staleOrderNotice" style={{ justifyContent: 'center', flexWrap: 'wrap', gap: 10 }}><span>Paid for photos before on this device?</span><button type="button" className="linkButton" onClick={recoverStaleOrder}>Recover my download</button></div>}

      {!matched ? <section className="howItWorks"><div className="howIntro"><span className="eyebrow">HOW IT WORKS</span><h2>One selfie. Your gallery.</h2></div><div className="howGrid"><Feature icon={<Search/>} n="01" title="Match your face" copy="Your selfie is compared with faces detected in event photos."/><Feature icon={<Lock/>} n="02" title="Preview securely" copy="Customers receive a clear, downscaled preview that can be downloaded for free; the full-resolution original stays private until verified payment."/><Feature icon={<IndianRupee/>} n="03" title="Buy what you want" copy="₹5 single photo · ₹15 group photo · free preview download · originals unlock after secure payment verification."/></div></section> : <section className="resultsSection"><div className="resultHeader"><div><span className="eyebrow">MATCH RESULTS</span><h2>Your photos <span>· {displayPhotos.length} matches</span></h2></div><div className="resultTrust"><Lock size={14}/> Originals locked</div></div><div className="photoGrid">{displayPhotos.map((p) => <div key={p.id} className={`photoCard ${selected.includes(p.id) ? 'chosen' : ''}`} role="button" tabIndex={0} onClick={() => toggle(p.id)} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(p.id); } }}><img src={p.preview_url} alt="Event preview" crossOrigin="anonymous"/><div className="photoGradient"/><div className="photoBottom"><span>{Number(p.people_count || 1) > 1 ? 'Group' : 'Single'} · {p.people_count || 1} {(p.people_count || 1) === 1 ? 'face' : 'faces'}</span><b>₹{p.price || (Number(p.people_count || 1) > 1 ? 15 : 5)}</b></div>{selected.includes(p.id) && <div className="selectedBadge"><Check size={16}/></div>}<a className="previewLock" href={p.preview_url} download={p.original_filename || 'smf-preview.jpg'} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()}>DOWNLOAD FREE PREVIEW</a></div>)}</div><div className="pricingRow"><div><b>Single photo</b><span>₹5</span></div><div><b>Group photo</b><span>₹15</span></div><div className="pricingNote"><ShieldCheck size={18}/> Free preview download · Full-resolution originals remain private until payment verification.</div></div></section>}

      {selected.length > 0 && !paymentSent && <div className="checkoutBar"><div className="checkoutSummary"><b>{selected.length} selected</b><span>Original-quality downloads</span></div><div className="checkoutAction"><strong>₹{total}</strong><button className="primaryButton" onClick={() => setPaymentOpen(true)} disabled={paymentLoading}>{paymentLoading ? <><Loader2 size={17} className="spin"/> Processing…</> : <>Pay securely <ArrowRight size={17}/></>}</button></div></div>}
    </> : null}

    {cameraOpen && <CameraModal videoRef={videoRef} onCapture={captureCameraSelfie} onClose={stopCamera}/>} 
    {paymentOpen && <PaymentModal amount={total} onClose={() => setPaymentOpen(false)} onSubmit={submitPayment}/>}<footer className="footer">© 2026 SMF Studio · Face Match Photo Delivery · Secure checkout</footer>
  </main>;
}

function loadRazorpayScript() {
  return new Promise((resolve) => {
    if (typeof window !== 'undefined' && window.Razorpay) return resolve(true);
    const existing = document.querySelector('script[src="https://checkout.razorpay.com/v1/checkout.js"]');
    if (existing) {
      existing.addEventListener('load', () => resolve(true), { once: true });
      existing.addEventListener('error', () => resolve(false), { once: true });
      return;
    }
    const script = document.createElement('script');
    script.src = 'https://checkout.razorpay.com/v1/checkout.js';
    script.async = true;
    script.onload = () => resolve(true);
    script.onerror = () => resolve(false);
    document.body.appendChild(script);
  });
}

function Feature({ icon, n, title, copy }) { return <div className="feature"><div className="featureTop"><span>{n}</span><div>{icon}</div></div><h3>{title}</h3><p>{copy}</p></div>; }

function CameraModal({ videoRef, onCapture, onClose }) {
  return <div className="cameraBackdrop"><div className="cameraModal"><div className="cameraHeader"><div><div className="modalEyebrow"><Video size={14}/> CAMERA SCAN</div><h2>Take a clear selfie</h2><p>Keep your face centered and look at the camera.</p></div><button className="closeButton" onClick={onClose}><X size={19}/></button></div><div className="cameraViewport"><video ref={videoRef} autoPlay playsInline muted/></div><button className="captureButton" onClick={onCapture}><Camera size={19}/> Capture selfie</button></div></div>;
}

function PaymentModal({ amount, onClose, onSubmit }) {
  return <div className="modalBackdrop"><div className="paymentModal"><button className="closeButton" onClick={onClose}><X size={19}/></button><div className="modalEyebrow"><IndianRupee size={15}/> SECURE CHECKOUT</div><h2>Pay ₹{amount}</h2><p>Continue to Razorpay for UPI, cards and other supported payment methods. Payment is verified securely on our server before originals are unlocked.</p><div className="checkoutPreview"><ShieldCheck size={18}/><div><b>Automatic verification</b><span>No UTR or manual payment proof required.</span></div></div><button className="wide primaryButton" onClick={onSubmit}>Continue to Razorpay <ArrowRight size={17}/></button><div className="modalFoot"><Lock size={13}/> Secure server-side payment verification</div></div></div>;
}
