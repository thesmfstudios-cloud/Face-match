'use client';

import { useMemo, useRef, useState } from 'react';
import {
  ArrowRight,
  Camera,
  Check,
  CheckCircle2,
  ChevronRight,
  Download,
  ImagePlus,
  IndianRupee,
  Lock,
  QrCode,
  Search,
  ShieldCheck,
  Sparkles,
  Upload,
  Users,
  X,
  Zap,
} from 'lucide-react';

const DEMO_PHOTOS = [
  { id: 1, people: 1, type: 'Single', price: 10, image: 'https://images.unsplash.com/photo-1511632765486-a01980e01a18?w=1200&q=80' },
  { id: 2, people: 4, type: 'Group', price: 30, image: 'https://images.unsplash.com/photo-1517457373958-b7bdd4587205?w=1200&q=80' },
  { id: 3, people: 8, type: 'Group', price: 30, image: 'https://images.unsplash.com/photo-1519167758481-83f550bb49b3?w=1200&q=80' },
  { id: 4, people: 2, type: 'Group', price: 30, image: 'https://images.unsplash.com/photo-1519741497674-611481863552?w=1200&q=80' },
  { id: 5, people: 1, type: 'Single', price: 10, image: 'https://images.unsplash.com/photo-1531058020387-3be344556be6?w=1200&q=80' },
  { id: 6, people: 6, type: 'Group', price: 30, image: 'https://images.unsplash.com/photo-1492684223066-81342ee5ff30?w=1200&q=80' },
];

const UPI_ID = process.env.NEXT_PUBLIC_UPI_ID || 'yourupi@bank';
const QR_URL = process.env.NEXT_PUBLIC_UPI_QR_URL || '';

export default function Home() {
  const [mode, setMode] = useState('customer');
  const [selfie, setSelfie] = useState('');
  const [matched, setMatched] = useState(false);
  const [selected, setSelected] = useState([]);
  const [paymentOpen, setPaymentOpen] = useState(false);
  const [utr, setUtr] = useState('');
  const [paymentSent, setPaymentSent] = useState(false);
  const [uploadedCount, setUploadedCount] = useState(0);

  const total = useMemo(
    () => selected.reduce((sum, id) => sum + (DEMO_PHOTOS.find((photo) => photo.id === id)?.price || 0), 0),
    [selected]
  );

  const togglePhoto = (id) => {
    setSelected((current) => (current.includes(id) ? current.filter((item) => item !== id) : [...current, id]));
  };

  const chooseSelfie = (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    setSelfie(file.name);
    setMatched(false);
    setPaymentSent(false);
  };

  const submitPayment = () => {
    if (!utr.trim()) return;
    setPaymentSent(true);
    setPaymentOpen(false);
    setUtr('');
  };

  return (
    <main className="shell">
      <header className="topbar">
        <div className="brand" onClick={() => setMode('customer')}>
          <div className="brandMark">SMF</div>
          <div>
            <div className="brandName">PHOTO MATCH</div>
            <div className="brandSub">SMART EVENT DELIVERY</div>
          </div>
        </div>
        <div className="topActions">
          <span className="secure"><ShieldCheck size={15} /> Private originals</span>
          <div className="segmented">
            <button className={mode === 'customer' ? 'active' : ''} onClick={() => setMode('customer')}>Customer</button>
            <button className={mode === 'admin' ? 'active' : ''} onClick={() => setMode('admin')}>Admin</button>
          </div>
        </div>
      </header>

      {mode === 'customer' ? (
        <CustomerView
          selfie={selfie}
          matched={matched}
          selected={selected}
          total={total}
          onChooseSelfie={chooseSelfie}
          onFind={() => setMatched(true)}
          onToggle={togglePhoto}
          onCheckout={() => setPaymentOpen(true)}
          paymentSent={paymentSent}
        />
      ) : (
        <AdminView uploadedCount={uploadedCount} setUploadedCount={setUploadedCount} />
      )}

      {paymentOpen && (
        <PaymentModal
          amount={total}
          utr={utr}
          setUtr={setUtr}
          onClose={() => setPaymentOpen(false)}
          onSubmit={submitPayment}
        />
      )}

      <footer className="footer">
        <span>© 2026 SMF Studio</span><span>•</span><span>Face Match Photo Delivery</span><span>•</span><span>Secure checkout</span>
      </footer>
    </main>
  );
}

function CustomerView({ selfie, matched, selected, total, onChooseSelfie, onFind, onToggle, onCheckout, paymentSent }) {
  return (
    <>
      <section className="hero">
        <div className="eyebrowPill"><Sparkles size={14} /> AI PHOTO DELIVERY · SAM COLLEGE</div>
        <h1>Find the moments<br /><em>you’re in.</em></h1>
        <p className="heroCopy">Upload one clear selfie. We match your face against the event gallery and show only the photos you appear in.</p>

        <div className="eventBar">
          <div>
            <span className="micro">EVENT</span>
            <strong>SAM College · 14 September 2026</strong>
          </div>
          <div className="eventMeta"><b>1,248</b> photos indexed</div>
        </div>
      </section>

      <section className="finderCard">
        <div className="finderIcon"><Camera size={28} /></div>
        <div className="finderBody">
          <div className="finderTitle">Find my photos</div>
          <div className="finderHint">Use a selfie with your face clearly visible.</div>
          <input id="selfie" hidden type="file" accept="image/*" onChange={onChooseSelfie} />
          <label className="uploadButton" htmlFor="selfie">
            {selfie ? <><CheckCircle2 size={17} /> {selfie}</> : <><Upload size={17} /> Choose selfie</>}
          </label>
        </div>
        <button className="primaryButton" disabled={!selfie} onClick={onFind}>Find photos <ArrowRight size={17} /></button>
      </section>

      {paymentSent && (
        <div className="notice successNotice"><CheckCircle2 size={17} /> Payment submitted. Your original-download request is waiting for verification.</div>
      )}

      {!matched ? (
        <section className="howItWorks">
          <div className="howIntro"><span className="eyebrow">HOW IT WORKS</span><h2>One selfie. Your gallery.</h2></div>
          <div className="howGrid">
            <Feature icon={<Search />} number="01" title="Match your face" copy="Your selfie is used to find matching event photos." />
            <Feature icon={<Lock />} number="02" title="Preview securely" copy="Customers see a protected preview, never the original." />
            <Feature icon={<IndianRupee />} number="03" title="Buy only what you want" copy="₹10 single photo · ₹30 group photo." />
          </div>
        </section>
      ) : (
        <section className="resultsSection">
          <div className="resultHeader">
            <div><span className="eyebrow">MATCH RESULTS</span><h2>Your photos <span>· {DEMO_PHOTOS.length} matches</span></h2></div>
            <div className="resultTrust"><Lock size={14} /> Originals locked</div>
          </div>

          <div className="photoGrid">
            {DEMO_PHOTOS.map((photo) => (
              <PhotoCard key={photo.id} photo={photo} chosen={selected.includes(photo.id)} onToggle={() => onToggle(photo.id)} />
            ))}
          </div>

          <div className="pricingRow">
            <div><b>Single photo</b><span>₹10</span></div>
            <div><b>Group photo</b><span>₹30</span></div>
            <div className="pricingNote"><ShieldCheck size={18} /> Full-resolution originals stay private until payment approval.</div>
          </div>
        </section>
      )}

      {selected.length > 0 && (
        <div className="checkoutBar">
          <div className="checkoutSummary"><b>{selected.length} selected</b><span>Original-quality downloads</span></div>
          <div className="checkoutAction"><strong>₹{total}</strong><button className="primaryButton" onClick={onCheckout}>Pay via UPI <ArrowRight size={17} /></button></div>
        </div>
      )}
    </>
  );
}

function Feature({ icon, number, title, copy }) {
  return <div className="feature"><div className="featureTop"><span>{number}</span><div>{icon}</div></div><h3>{title}</h3><p>{copy}</p></div>;
}

function PhotoCard({ photo, chosen, onToggle }) {
  return (
    <button className={`photoCard ${chosen ? 'chosen' : ''}`} onClick={onToggle} aria-label={`Select photo ${photo.id}`}>
      <img src={photo.image} alt="Event preview" />
      <div className="blurLayer" />
      <div className="watermark">SMF STUDIO</div>
      <div className="photoGradient" />
      <div className="photoBottom"><span>{photo.type} · {photo.people} {photo.people === 1 ? 'face' : 'faces'}</span><b>₹{photo.price}</b></div>
      {chosen && <div className="selectedBadge"><Check size={16} /></div>}
      <div className="previewLock"><Lock size={13} /> PREVIEW</div>
    </button>
  );
}

function PaymentModal({ amount, utr, setUtr, onClose, onSubmit }) {
  return (
    <div className="modalBackdrop" role="dialog" aria-modal="true">
      <div className="paymentModal">
        <button className="closeButton" onClick={onClose}><X size={19} /></button>
        <div className="modalEyebrow"><QrCode size={15} /> UPI PAYMENT</div>
        <h2>Pay ₹{amount}</h2>
        <p>Scan your UPI QR or pay to the UPI ID below, then enter the UTR / transaction ID.</p>
        <div className="qrBox">
          {QR_URL ? <img src={QR_URL} alt="UPI payment QR" /> : <div className="qrPlaceholder"><QrCode size={42} /><span>Add your UPI QR in <code>NEXT_PUBLIC_UPI_QR_URL</code></span></div>}
        </div>
        <div className="upiId"><span>UPI ID</span><b>{UPI_ID}</b></div>
        <label className="utrLabel">Transaction / UTR number<input value={utr} onChange={(event) => setUtr(event.target.value)} placeholder="Enter UTR after payment" /></label>
        <button className="primaryButton wide" disabled={!utr.trim()} onClick={onSubmit}>Submit payment proof <ArrowRight size={17} /></button>
        <div className="modalFoot"><ShieldCheck size={14} /> Your original files remain private until payment approval.</div>
      </div>
    </div>
  );
}

function AdminView({ uploadedCount, setUploadedCount }) {
  const inputRef = useRef(null);
  return (
    <section className="adminPage">
      <div className="adminHeader">
        <div><span className="eyebrow">ADMIN CONSOLE</span><h1>Event photo manager</h1><p>Upload originals, process face matches, publish a customer link and approve paid downloads.</p></div>
        <div className="ready"><CheckCircle2 size={16} /> System ready</div>
      </div>
      <div className="statsGrid">
        <Stat label="EVENT" value="SAM College" />
        <Stat label="PHOTOS" value={uploadedCount || '1,248'} />
        <Stat label="MATCHED FACES" value="—" />
        <Stat label="REVENUE" value="₹0" />
      </div>
      <div className="adminGrid">
        <div className="uploadPanel">
          <div className="uploadIcon"><ImagePlus size={30} /></div>
          <h2>Upload event originals</h2>
          <p>JPG, PNG or HEIC. Originals are intended for private storage.</p>
          <input ref={inputRef} hidden type="file" multiple accept="image/*" onChange={(event) => setUploadedCount(event.target.files?.length || 0)} />
          <button onClick={() => inputRef.current?.click()} className="darkButton"><Upload size={17} /> Choose photos</button>
          {!!uploadedCount && <div className="uploadSuccess"><CheckCircle2 size={16} /> {uploadedCount} files selected and ready</div>}
        </div>
        <div className="workflowPanel">
          <div className="panelTitle">Production workflow</div>
          <WorkflowStep num="01" title="Upload originals" text="Store full-resolution images privately." status="Ready" />
          <WorkflowStep num="02" title="Generate previews + embeddings" text="Create preview derivatives and face vectors." status="Next" />
          <WorkflowStep num="03" title="Publish event QR / link" text="Customers use a selfie to discover matches." status="Next" />
          <WorkflowStep num="04" title="Approve payments" text="Verify UTRs and unlock downloads." status="Next" />
        </div>
      </div>
      <div className="securityCallout"><ShieldCheck size={19} /><div><b>Security by design</b><p>Original files should live in private storage. Download endpoints should issue short-lived signed URLs only after an approved order.</p></div></div>
    </section>
  );
}

function Stat({ label, value }) { return <div className="stat"><span>{label}</span><b>{value}</b></div>; }
function WorkflowStep({ num, title, text, status }) { return <div className="workflowStep"><span className="stepNum">{num}</span><div><b>{title}</b><p>{text}</p></div><span className="stepStatus">{status} <ChevronRight size={14} /></span></div>; }
