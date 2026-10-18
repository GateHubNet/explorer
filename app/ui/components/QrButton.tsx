import type { QrPicture } from "../../server/account-view";

/**
 * A button that shows the QR code of an address, or of its X-address when the page was opened with a destination tag (`qr.tag`). The code is drawn by the Worker (`qrPath`) and arrives here as the path of a
 * picture, so no encoder is in the browser. It is a `<details>`, closed to begin with, so it needs no script: the summary is the
 * button, and the keyboard and screen readers know how to use it.
 *
 * The picture is black on white whatever the theme: scanners expect dark modules on a light ground, with a quiet zone of four
 * modules around them, which the `viewBox` leaves.
 */
export function QrButton({ address, qr }: { address: string; qr: QrPicture }) {
  const side = qr.size + 8;
  const label =
    qr.tag === null
      ? `QR code of the address ${address}`
      : `QR code of the X-address ${qr.content}, which is the address with destination tag ${qr.tag}`;
  return (
    <details className="qr">
      <summary className="copy qr__toggle" aria-label="Show QR code">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
          <rect x="3" y="3" width="7" height="7" rx="1" />
          <rect x="14" y="3" width="7" height="7" rx="1" />
          <rect x="3" y="14" width="7" height="7" rx="1" />
          <path d="M14 14h3v3h-3zM20 14v.01M14 20h.01M17 20h4v-3" />
        </svg>
      </summary>
      <div className="qr__panel">
        <svg className="qr__code" viewBox={`-4 -4 ${side} ${side}`} role="img" aria-label={label} shapeRendering="crispEdges">
          <rect x="-4" y="-4" width={side} height={side} fill="#ffffff" />
          <path d={qr.path} fill="#000000" />
        </svg>
        <p className="faint">{qr.tag === null ? "Scan it with a wallet to get the address." : `Scan it with a wallet to get the address and destination tag ${qr.tag}.`}</p>
      </div>
    </details>
  );
}
