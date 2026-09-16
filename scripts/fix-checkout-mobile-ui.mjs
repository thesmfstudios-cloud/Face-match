import fs from 'node:fs';

const cssPath = 'app/globals.css';
let css = fs.readFileSync(cssPath, 'utf8');

const marker = '/* SMF_CHECKOUT_MOBILE_UI_V1 */';
if (!css.includes(marker)) {
  css += `\n\n${marker}\n.checkoutPreview{display:flex;align-items:flex-start;gap:11px;padding:13px 14px;margin:0 0 14px;background:#111;border:1px solid #2d2d2d;border-radius:8px;min-width:0}\n.checkoutPreview>svg{flex:0 0 auto;margin-top:1px}\n.checkoutPreview>div{display:flex;flex:1;min-width:0;flex-direction:column;gap:3px}\n.checkoutPreview b{display:block;font-size:11px;line-height:1.25;color:#f2eee7}\n.checkoutPreview span{display:block;font-size:9px;line-height:1.45;color:#8f8a82}\n.paymentModal{max-height:calc(100dvh - 32px);overflow:auto;-webkit-overflow-scrolling:touch}\n@media (max-width:640px){\n  .modalBackdrop{padding:16px}\n  .paymentModal{width:100%;max-width:430px;padding:22px 20px;border-radius:14px}\n  .paymentModal h2{font-size:31px;margin-right:42px}\n  .paymentModal>p{font-size:11px;line-height:1.55;margin-bottom:14px}\n  .checkoutPreview{gap:10px;padding:12px}\n  .checkoutPreview b{font-size:11px}\n  .checkoutPreview span{font-size:9.5px}\n  .paymentModal .wide{min-height:48px}\n  .modalFoot{line-height:1.4;align-items:flex-start}\n}\n`;
  fs.writeFileSync(cssPath, css);
}
