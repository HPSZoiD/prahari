import { useEffect, useRef, useState } from 'react';
import QRCode from 'qrcode';

// QR share screen: the student link is this site's root URL.
// Rendered locally (qrcode lib) — no external service on demo day.
export default function ShareQR({ onClose }) {
  const canvasRef = useRef(null);
  const [url] = useState(() => window.location.origin + '/');
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (canvasRef.current) {
      QRCode.toCanvas(canvasRef.current, url, {
        width: 300, margin: 2,
        color: { dark: '#161616', light: '#FFFFFF' },
      }).catch(() => { /* non-fatal */ });
    }
  }, [url]);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch { /* clipboard blocked — the URL is selectable text */ }
  };

  return (
    <div className="modal-backdrop" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal" role="dialog" aria-label="Share student link">
        <h3>Share the student app</h3>
        <p className="muted small">
          Students open this link, fill a 30-second local form and hold the SOS
          button. No app, no signup.
        </p>
        <div className="qr-box">
          <canvas ref={canvasRef} aria-label={`QR code for ${url}`} />
          <div className="qr-url">{url}</div>
        </div>
        <div className="modal-actions">
          <button className="btn btn-outline" onClick={copy}>{copied ? 'Copied' : 'Copy link'}</button>
          <a className="btn" href={url} target="_blank" rel="noreferrer">Open student app ↗</a>
        </div>
      </div>
    </div>
  );
}
