'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowRight, Camera, Check, CheckCircle2, ImagePlus, IndianRupee, Lock, Search, ShieldCheck, Sparkles, Upload, X, Loader2, RefreshCw, Video } from 'lucide-react';
import { getSupabaseBrowser } from '../lib/supabase-browser';

const EVENT_SLUG = 'sam-college-2026';
const MODEL_URL = 'https://cdn.jsdelivr.net/npm/@vladmandic/face-api/model/';

const DEMO_PHOTOS = [
  { id: 'demo-1', people_count: 1, price: 5, preview_url: 'https://images.unsplash.com/photo-1511632765486-a01980e01a18?w=1200&q=80' },
  { id: 'demo-2', people_count: 4, price: 15, preview_url: 'https://images.unsplash.com/photo-1517457373958-b7bdd4587205?w=1200&q=80' },
  { id: 'demo-3', people_count: 8, price: 15, preview_url: 'https://images.unsplash.com/photo-1519167758481-83f550bb49b3?w=1200&q=80' },
  { id: 'demo-4', people_count: 2, price: 15, preview_url: 'https://images.unsplash.com/photo-1519741497674-611481863552?w=1200&q=80' },
  { id: 'demo-5', people_count: 1, price: 5, preview_url: 'https://images.unsplash.com/photo-1531058020387-3be344556be6?w=1200&q=80' },
  { id: 'demo-6', people_count: 6, price: 15, preview_url: 'https://images.unsplash.com/photo-1492684223066-81342ee5ff30?w=1200&q=80' },
];

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
  const [notificationPermission, setNotificationPermission] = useState('default');

  const livePhotos = photos.length ? photos : DEMO_PHOTOS;
  const total = useMemo(() => selected.reduce((sum, id) => { const p = livePhotos.find((x) => x.id === id); const people = Number(p?.people_count || 1); return sum + (people > 1 ? 15 : 5); }, 0), [selected, livePhotos]);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const supabase = getSupabaseBrowser();
        const { data: e, error: ee } = await supabase.from('fm_events').select('id,name,event_date,photos_count,upi_id,status').eq('slug', EVENT_SLUG).eq('status', 'live').single();
        if (ee) throw ee;
        const { data: p, error: pe } = await supabase.from('fm_photos').select('id,preview_path,original_filename,people_count,price,processing_status').eq('event_id', e.id).eq('processing_status', 'ready').order('created_at', { ascending: true });
        if (pe) throw pe;
        const mapped = (p || []).map((row) => ({ ...row, preview_url: supabase.storage.from('fm-previews').getPublicUrl(row.preview_path).data.publicUrl }));
        if (active) { setEvent(e); setPhotos(mapped); }
      } catch (err) {
        console.warn('Supabase not configured or migration not applied:', err);
        if (active) setDataError('Demo mode: connect Supabase to use live event photos.');
      }
    })();
    return () => { active = false; };
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
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false });
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
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    canvas.toBlob((blob) => {
      if (!blob) return;
      const file = new File([blob], `camera-selfie-${Date.now()}.jpg`, { type: 'image/jpeg' });
      setSelfie(file);
      setSelfieName('Camera selfie');
      setMatched(false);
      setMatchMessage('');
      setSelected([]);
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
  };

  const requestScanNotification = async () => {
    if (typeof window === 'undefined' || !('Notification' in window)) return;
    try {
      const permission = Notification.permission === 'default' ? await Notification.requestPermission() : Notification.permission;
      setNotificationPermission(permission);
    } catch {}
  };

  const notifyScanComplete = (count) => {
    if (typeof window === 'undefined' || !('Notification' in window) || Notification.permission !== 'granted') return;
    try {
      new Notification('SMF Photo Match', {
        body: count ? `${count} matching photos are ready to view.` : 'Your photo scan is complete. Tap to view your results.',
        icon: '/favicon.ico',
      });
    } catch {}
  };

  const runFaceMatch = async () => {
    if (!selfie) return;
    await requestScanNotification();
    await requestScanNotification();
    await requestScanNotification();
    await requestScanNotification();
    if (!photos.length) {
      setMatched(true);
      setMatchMessage('Demo mode is active. Supabase live photos will be matched after connection.');
      return;
    }
    setMatching(true);
    setMatchMessage('Scanning your photos… This can take up to 5–10 minutes. Please keep this page open.');
    try {
      const faceapi = await import('@vladmandic/face-api');
      await Promise.all([
        faceapi.nets.tinyFaceDetector.loadFromUri(MODEL_URL),
        faceapi.nets.faceLandmark68Net.loadFromUri(MODEL_URL),
        faceapi.nets.faceRecognitionNet.loadFromUri(MODEL_URL),
      ]);

      const selfieUrl = URL.createObjectURL(selfie);
      const selfieImg = await loadImage(selfieUrl);
      URL.revokeObjectURL(selfieUrl);
      const probe = await faceapi.detectSingleFace(selfieImg, new faceapi.TinyFaceDetectorOptions({ inputSize: 320, scoreThreshold: 0.5 }))
        .withFaceLandmarks().withFaceDescriptor();
      if (!probe) throw new Error('No clear face found in the selfie. Use a front-facing, well-lit selfie.');

      const results = [];
      for (const photo of photos) {
        try {
          const img = await loadImage(photo.preview_url, true);
          const faces = await faceapi.detectAllFaces(img, new faceapi.TinyFaceDetectorOptions({ inputSize: 416, scoreThreshold: 0.45 }))
            .withFaceLandmarks().withFaceDescriptors();
          const distances = faces.map((f) => faceapi.euclideanDistance(probe.descriptor, f.descriptor));
          const best = distances.length ? Math.min(...distances) : 9;
          if (best < 0.53) results.push({ ...photo, match_distance: best, people_count: Math.max(Number(photo.people_count || 1), faces.length), price: Math.max(Number(photo.people_count || 1), faces.length) > 1 ? 15 : 5 });
        } catch (err) {
          console.warn('Could not scan photo', photo.id, err);
        }
      }
      setMatched(true);
      setMatching(false);
      setMatchMessage(results.length ? `${results.length} matching photos found.` : 'No close face matches found. Try a clearer selfie or better lighting.');
      notifyScanComplete(results.length);
      notifyScanComplete(results.length);
      notifyScanComplete(results.length);
      notifyScanComplete(results.length);
      setPhotos((current) => {
        const map = new Map(results.map((r) => [r.id, r]));
        return current.map((p) => map.get(p.id) || { ...p, no_match: true });
      });
    } catch (err) {
      setMatching(false);
      setMatchMessage(err?.message || 'Face matching failed.');
    }
  };

  const toggle = (id) => setSelected((s) => s.includes(id) ? s.filter((x) => x !== id) : [...s, id]);

  const downloadApprovedPhotos = async (approvedOrderId) => {
    if (!approvedOrderId || !selected.length || downloadStarting || downloadStarted) return;
    setDownloadStarting(true);
    setMatchMessage('Payment verified. Starting your original downloads…');
    try {
      for (let i = 0; i < selected.length; i++) {
        const a = document.createElement('a');
        a.href = `/api/orders/${approvedOrderId}/download?photoId=${encodeURIComponent(selected[i])}`;
        a.target = '_blank';
        a.rel = 'noopener';
        document.body.appendChild(a);
        a.click();
        a.remove();
        if (i < selected.length - 1) await new Promise((r) => setTimeout(r, 900));
      }
      setDownloadStarted(true);
      setMatchMessage(`${selected.length} original download${selected.length === 1 ? '' : 's'} started.`);
    } finally {
      setDownloadStarting(false);
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
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ eventSlug: EVENT_SLUG, selectedPhotoIds: selected, groupPhotoIds: selected.filter((id) => Number(livePhotos.find((p) => p.id === id)?.people_count || 1) > 1) }),
      });
      const createBody = await createRes.json();
      if (!createRes.ok) throw new Error(createBody.error || 'Could not create payment order.');
      const options = {
        key: process.env.NEXT_PUBLIC_RAZORPAY_KEY_ID,
        amount: createBody.amount, currency: createBody.currency,
        name: 'SMF Studios',
        description: `${selected.length} event photo${selected.length === 1 ? '' : 's'}`,
        order_id: createBody.order_id,
        handler: async (response) => {
          try {
            setMatchMessage('Verifying payment securely…');
            const verifyRes = await fetch('/api/verify-payment', {
              method: 'POST', headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                eventSlug: EVENT_SLUG, selectedPhotoIds: selected, groupPhotoIds: selected.filter((id) => Number(livePhotos.find((p) => p.id === id)?.people_count || 1) > 1),
                razorpay_payment_id: response.razorpay_payment_id,
                razorpay_order_id: response.razorpay_order_id,
                razorpay_signature: response.razorpay_signature,
              }),
            });
            const verifyBody = await verifyRes.json();
            if (!verifyRes.ok || !verifyBody.ok) throw new Error(verifyBody.error || 'Payment verification failed.');
            const approvedId = verifyBody.order?.id;
            setOrderId(approvedId || '');
            setPaymentSent(true);
            setMatchMessage('Payment verified. Starting your original downloads…');
            setPaymentLoading(false);
            if (approvedId) await downloadApprovedPhotos(approvedId);
          } catch (error) {
            setPaymentLoading(false);
            setMatchMessage(error?.message || 'Payment verification failed.');
          }
        },
        modal: { backdropclose: false, ondismiss: () => { setPaymentLoading(false); setMatchMessage('Payment cancelled.'); } },
        notes: { event: EVENT_SLUG }, theme: { color: '#111111' },
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
    if (!orderId || !paymentSent || downloadStarted) return undefined;
    let cancelled = false;
    let timer;
    const check = async () => {
      try {
        const res = await fetch(`/api/orders/${orderId}/status`, { cache: 'no-store' });
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
  }, [orderId, paymentSent, downloadStarted, selected]);

  const displayPhotos = matched && photos.length ? photos.filter((p) => !p.no_match) : livePhotos;
  const eventName = event?.name || 'SAM College · 14 September 2026';
  const photoCount = event?.photos_count || photos.length || '1,248';

  return <main className="shell">
    <header className="topbar">
      <div className="brand" onClick={() => setMode('customer')}><div className="brandMark">SMF</div><div><div className="brandName">PHOTO MATCH</div><div className="brandSub">SMART EVENT DELIVERY</div></div></div>
      <div className="topActions"><span className="secure"><ShieldCheck size={15}/> Private originals</span><div className="segmented"><button className={mode === 'customer' ? 'active' : ''} onClick={() => setMode('customer')}>Customer</button><button className="adminLinkButton" onClick={() => { window.location.href = '/admin'; }}>Admin</button></div></div>
    </header>

    {mode === 'customer' ? <>
      <section className="hero"><div className="eyebrowPill"><Sparkles size={14}/> AI PHOTO DELIVERY · SAM COLLEGE</div><h1>Find the moments<br/><em>you’re in.</em></h1><p className="heroCopy">Upload one clear selfie. We run face recognition against the event gallery and only show likely matches.</p><div className="eventBar"><div><span className="micro">EVENT</span><strong>{eventName}</strong></div><div className="eventMeta"><b>{photoCount}</b> photos indexed</div></div></section>

      <section className="finderCard"><div className="finderIcon"><Camera size={28}/></div><div className="finderBody"><div className="finderTitle">Find my photos</div><div className="finderHint">Use a front-facing selfie or camera capture with your face clearly visible.</div><input id="selfie" hidden type="file" accept="image/*" capture="user" onChange={chooseSelfie}/><div className="finderControls"><label className="uploadButton" htmlFor="selfie">{selfie ? <><CheckCircle2 size={17}/> {selfieName}</> : <><Upload size={17}/> Upload photo</>}</label><button type="button" className="cameraButton" onClick={startCamera}><Video size={17}/> Use camera</button></div></div><button className="primaryButton" disabled={!selfie || matching} onClick={runFaceMatch}>{matching ? <><Loader2 size={17} className="spin"/> Matching…</> : <>Find photos <ArrowRight size={17}/></>}</button></section>
      <div className="scanHelp">⏳ Finding your photos can take up to 5–10 minutes. Please keep this page open.<br/><span>🔔 We’ll let you know as soon as your photos are ready.</span></div>

      {dataError && <div className="notice">{dataError}</div>}
      {matchMessage && <div className={`notice ${matchMessage.includes('found') ? 'successNotice' : ''}`}>{matchMessage}</div>}
      {paymentSent && <div className="notice successNotice"><CheckCircle2 size={17}/> Payment verified successfully. Your original downloads are starting now.{orderId && <> Order: <code>{orderId}</code></>}</div>}

      {!matched ? <section className="howItWorks"><div className="howIntro"><span className="eyebrow">HOW IT WORKS</span><h2>One selfie. Your gallery.</h2></div><div className="howGrid"><Feature icon={<Search/>} n="01" title="Match your face" copy="Your selfie is compared with faces detected in event photos."/><Feature icon={<Lock/>} n="02" title="Preview securely" copy="Customers receive a clear, downscaled preview that can be downloaded for free; the full-resolution original stays private until verified payment."/><Feature icon={<IndianRupee/>} n="03" title="Buy what you want" copy="₹5 single photo · ₹15 group photo · free preview download · originals unlock after secure payment verification."/></div></section> : <section className="resultsSection"><div className="resultHeader"><div><span className="eyebrow">MATCH RESULTS</span><h2>Your photos <span>· {displayPhotos.length} matches</span></h2></div><div className="resultTrust"><Lock size={14}/> Originals locked</div></div><div className="photoGrid">{displayPhotos.map((p) => <div key={p.id} className={`photoCard ${selected.includes(p.id) ? 'chosen' : ''}`} role="button" tabIndex={0} onClick={() => toggle(p.id)} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(p.id); } }}><img src={p.preview_url} alt="Event preview" crossOrigin="anonymous"/><div className="photoGradient"/><div className="photoBottom"><span>{Number(p.people_count || 1) > 1 ? 'Group' : 'Single'} · {p.people_count || 1} {(p.people_count || 1) === 1 ? 'face' : 'faces'}</span><b>₹{p.price || (Number(p.people_count || 1) > 1 ? 15 : 5)}</b></div>{selected.includes(p.id) && <div className="selectedBadge"><Check size={16}/></div>}<a className="previewLock" href={p.preview_url} download={p.original_filename || 'smf-preview.jpg'} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()}>DOWNLOAD FREE PREVIEW</a></div>)}</div><div className="pricingRow"><div><b>Single photo</b><span>₹5</span></div><div><b>Group photo</b><span>₹15</span></div><div className="pricingNote"><ShieldCheck size={18}/> Free preview download · Full-resolution originals remain private until payment verification.</div></div></section>}

      {selected.length > 0 && <div className="checkoutBar"><div className="checkoutSummary"><b>{selected.length} selected</b><span>Original-quality downloads</span></div><div className="checkoutAction"><strong>₹{total}</strong><button className="primaryButton" onClick={() => setPaymentOpen(true)} disabled={paymentLoading}>{paymentLoading ? <><Loader2 size={17} className="spin"/> Processing…</> : <>Pay securely <ArrowRight size={17}/></>}</button></div></div>}
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
async function loadImage(src, crossOrigin = false) {
  return new Promise((resolve, reject) => { const img = new Image(); if (crossOrigin) img.crossOrigin = 'anonymous'; img.onload = () => resolve(img); img.onerror = () => reject(new Error('Could not load event preview.')); img.src = src; });
}

function Feature({ icon, n, title, copy }) { return <div className="feature"><div className="featureTop"><span>{n}</span><div>{icon}</div></div><h3>{title}</h3><p>{copy}</p></div>; }

function CameraModal({ videoRef, onCapture, onClose }) {
  return <div className="cameraBackdrop"><div className="cameraModal"><div className="cameraHeader"><div><div className="modalEyebrow"><Video size={14}/> CAMERA SCAN</div><h2>Take a clear selfie</h2><p>Keep your face centered and look at the camera.</p></div><button className="closeButton" onClick={onClose}><X size={19}/></button></div><div className="cameraViewport"><video ref={videoRef} autoPlay playsInline muted/></div><button className="captureButton" onClick={onCapture}><Camera size={19}/> Capture selfie</button></div></div>;
}

function PaymentModal({ amount, onClose, onSubmit }) {
  return <div className="modalBackdrop"><div className="paymentModal"><button className="closeButton" onClick={onClose}><X size={19}/></button><div className="modalEyebrow"><IndianRupee size={15}/> SECURE CHECKOUT</div><h2>Pay ₹{amount}</h2><p>Continue to Razorpay for UPI, cards and other supported payment methods. Payment is verified securely on our server before originals are unlocked.</p><div className="checkoutPreview"><ShieldCheck size={18}/><div><b>Automatic verification</b><span>No UTR or manual payment proof required.</span></div></div><button className="primaryButton wide" onClick={onSubmit}>Continue to Razorpay <ArrowRight size={17}/></button><div className="modalFoot"><ShieldCheck size={14}/> Full-resolution originals unlock only after successful payment verification.</div></div></div>;
}

function FeatureAdminRemoved() { return null; }
