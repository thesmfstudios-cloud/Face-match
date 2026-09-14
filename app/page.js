'use client';

import { useMemo, useRef, useState } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import { ArrowRight, Camera, Check, CheckCircle2, ImagePlus, IndianRupee, Lock, Search, ShieldCheck, Sparkles, Upload, X } from 'lucide-react';

const UPI_ID = '9200010123@ybl';
const DEMO_PHOTOS = [
  { id: 1, people: 1, type: 'Single', price: 10, image: 'https://images.unsplash.com/photo-1511632765486-a01980e01a18?w=1200&q=80' },
  { id: 2, people: 4, type: 'Group', price: 30, image: 'https://images.unsplash.com/photo-1517457373958-b7bdd4587205?w=1200&q=80' },
  { id: 3, people: 8, type: 'Group', price: 30, image: 'https://images.unsplash.com/photo-1519167758481-83f550bb49b3?w=1200&q=80' },
  { id: 4, people: 2, type: 'Group', price: 30, image: 'https://images.unsplash.com/photo-1519741497674-611481863552?w=1200&q=80' },
  { id: 5, people: 1, type: 'Single', price: 10, image: 'https://images.unsplash.com/photo-1531058020387-3be344556be6?w=1200&q=80' },
  { id: 6, people: 6, type: 'Group', price: 30, image: 'https://images.unsplash.com/photo-1492684223066-81342ee5ff30?w=1200&q=80' },
];

export default function Home() {
  const [mode, setMode] = useState('customer');
  const [selfie, setSelfie] = useState('');
  const [matched, setMatched] = useState(false);
  const [selected, setSelected] = useState([]);
  const [paymentOpen, setPaymentOpen] = useState(false);
  const [utr, setUtr] = useState('');
  const [paymentSent, setPaymentSent] = useState(false);
  const [uploadedCount, setUploadedCount] = useState(0);
  const total = useMemo(() => selected.reduce((s, id) => s + (DEMO_PHOTOS.find(p => p.id === id)?.price || 0), 0), [selected]);
  const toggle = id => setSelected(s => s.includes(id) ? s.filter(x => x !== id) : [...s, id]);
  const chooseSelfie = e => { const f = e.target.files?.[0]; if (f) { setSelfie(f.name); setMatched(false); } };
  const submitPayment = () => { if (!utr.trim()) return; setPaymentSent(true); setPaymentOpen(false); setUtr(''); };

  return <main className="shell">
    <header className="topbar"><div className="brand" onClick={() => setMode('customer')}><div className="brandMark">SMF</div><div><div className="brandName">PHOTO MATCH</div><div className="brandSub">SMART EVENT DELIVERY</div></div></div><div className="topActions"><span className="secure"><ShieldCheck size={15}/> Private originals</span><div className="segmented"><button className={mode==='customer'?'active':''} onClick={()=>setMode('customer')}>Customer</button><button className={mode==='admin'?'active':''} onClick={()=>setMode('admin')}>Admin</button></div></div></header>
    {mode==='customer' ? <>
      <section className="hero"><div className="eyebrowPill"><Sparkles size={14}/> AI PHOTO DELIVERY · SAM COLLEGE</div><h1>Find the moments<br/><em>you’re in.</em></h1><p className="heroCopy">Upload one clear selfie. We match your face against the event gallery and show the photos you appear in.</p><div className="eventBar"><div><span className="micro">EVENT</span><strong>SAM College · 14 September 2026</strong></div><div className="eventMeta"><b>1,248</b> photos indexed</div></div></section>
      <section className="finderCard"><div className="finderIcon"><Camera size={28}/></div><div className="finderBody"><div className="finderTitle">Find my photos</div><div className="finderHint">Use a selfie with your face clearly visible.</div><input id="selfie" hidden type="file" accept="image/*" onChange={chooseSelfie}/><label className="uploadButton" htmlFor="selfie">{selfie?<><CheckCircle2 size={17}/> {selfie}</>:<><Upload size={17}/> Choose selfie</>}</label></div><button className="primaryButton" disabled={!selfie} onClick={()=>setMatched(true)}>Find photos <ArrowRight size={17}/></button></section>
      {paymentSent && <div className="notice successNotice"><CheckCircle2 size={17}/> Payment submitted. Waiting for verification.</div>}
      {!matched ? <section className="howItWorks"><div className="howIntro"><span className="eyebrow">HOW IT WORKS</span><h2>One selfie. Your gallery.</h2></div><div className="howGrid"><Feature icon={<Search/>} n="01" title="Match your face" copy="Your selfie finds matching event photos."/><Feature icon={<Lock/>} n="02" title="Preview securely" copy="Originals stay locked behind payment."/><Feature icon={<IndianRupee/>} n="03" title="Buy what you want" copy="₹10 single photo · ₹30 group photo."/></div></section> : <section className="resultsSection"><div className="resultHeader"><div><span className="eyebrow">MATCH RESULTS</span><h2>Your photos <span>· {DEMO_PHOTOS.length} matches</span></h2></div><div className="resultTrust"><Lock size={14}/> Originals locked</div></div><div className="photoGrid">{DEMO_PHOTOS.map(p=><button key={p.id} className={`photoCard ${selected.includes(p.id)?'chosen':''}`} onClick={()=>toggle(p.id)}><img src={p.image} alt="Event preview"/><div className="blurLayer"/><div className="watermark">SMF STUDIO</div><div className="photoGradient"/><div className="photoBottom"><span>{p.type} · {p.people} {p.people===1?'face':'faces'}</span><b>₹{p.price}</b></div>{selected.includes(p.id)&&<div className="selectedBadge"><Check size={16}/></div>}<div className="previewLock"><Lock size={13}/> PREVIEW</div></button>)}</div><div className="pricingRow"><div><b>Single photo</b><span>₹10</span></div><div><b>Group photo</b><span>₹30</span></div><div className="pricingNote"><ShieldCheck size={18}/> Full-resolution originals remain private.</div></div></section>}
      {selected.length>0 && <div className="checkoutBar"><div className="checkoutSummary"><b>{selected.length} selected</b><span>Original-quality downloads</span></div><div className="checkoutAction"><strong>₹{total}</strong><button className="primaryButton" onClick={()=>setPaymentOpen(true)}>Pay via UPI <ArrowRight size={17}/></button></div></div>}
    </> : <AdminView uploadedCount={uploadedCount} setUploadedCount={setUploadedCount}/>} 
    {paymentOpen && <PaymentModal amount={total} utr={utr} setUtr={setUtr} onClose={()=>setPaymentOpen(false)} onSubmit={submitPayment}/>}<footer className="footer">© 2026 SMF Studio · Face Match Photo Delivery · Secure checkout</footer>
  </main>
}

function Feature({icon,n,title,copy}){return <div className="feature"><div className="featureTop"><span>{n}</span><div>{icon}</div></div><h3>{title}</h3><p>{copy}</p></div>}
function PaymentModal({amount,utr,setUtr,onClose,onSubmit}){const payLink=`upi://pay?pa=${encodeURIComponent(UPI_ID)}&pn=SMF%20Studio&am=${amount}&cu=INR&tn=Photo%20Match`;return <div className="modalBackdrop"><div className="paymentModal"><button className="closeButton" onClick={onClose}><X size={19}/></button><div className="modalEyebrow"><IndianRupee size={15}/> UPI PAYMENT</div><h2>Pay ₹{amount}</h2><p>Scan the QR below, pay using your UPI app, then enter the UTR / transaction ID.</p><div className="qrBox"><QRCodeSVG value={payLink} size={190} includeMargin/></div><a className="upiPayButton" href={payLink}>Open UPI App</a><div className="upiId"><span>UPI ID</span><b>{UPI_ID}</b></div><label className="utrLabel">Transaction / UTR number<input value={utr} onChange={e=>setUtr(e.target.value)} placeholder="Enter UTR after payment"/></label><button className="primaryButton wide" disabled={!utr.trim()} onClick={onSubmit}>Submit payment proof <ArrowRight size={17}/></button><div className="modalFoot"><ShieldCheck size={14}/> Originals unlock only after verification.</div></div></div>}
function AdminView({uploadedCount,setUploadedCount}){const ref=useRef(null);return <section className="adminPage"><div className="adminHeader"><div><span className="eyebrow">ADMIN CONSOLE</span><h1>Event photo manager</h1><p>Upload originals, process face matches, publish a customer link and approve paid downloads.</p></div><div className="ready"><CheckCircle2 size={16}/> System ready</div></div><div className="statsGrid"><Stat l="EVENT" v="SAM College"/><Stat l="PHOTOS" v={uploadedCount||'1,248'}/><Stat l="MATCHED FACES" v="—"/><Stat l="REVENUE" v="₹0"/></div><div className="adminGrid"><div className="uploadPanel"><div className="uploadIcon"><ImagePlus size={30}/></div><h2>Upload event originals</h2><p>JPG, PNG or HEIC. Originals are intended for private storage.</p><input ref={ref} hidden type="file" multiple accept="image/*" onChange={e=>setUploadedCount(e.target.files?.length||0)}/><button onClick={()=>ref.current?.click()} className="darkButton"><Upload size={17}/> Choose photos</button>{!!uploadedCount&&<div className="uploadSuccess"><CheckCircle2 size={16}/> {uploadedCount} files selected</div>}</div><div className="workflowPanel"><div className="panelTitle">Production workflow</div><Workflow n="01" t="Upload originals" s="Ready"/><Workflow n="02" t="Generate previews + embeddings" s="Next"/><Workflow n="03" t="Publish event QR / link" s="Next"/><Workflow n="04" t="Approve payments" s="Next"/></div></div><div className="securityCallout"><ShieldCheck size={19}/><div><b>Private originals</b><p>Store full-resolution files privately and issue short-lived signed downloads only after an approved payment.</p></div></div></section>}
function Stat({l,v}){return <div className="stat"><span>{l}</span><b>{v}</b></div>};function Workflow({n,t,s}){return <div className="workflowStep"><span className="stepNum">{n}</span><div><b>{t}</b></div><span className="stepStatus">{s}</span></div>}
