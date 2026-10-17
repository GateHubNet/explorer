import { AlertIcon } from "./icons";

/**
 * One part of a page that could not be loaded while the rest is fine (spec 10): "Couldn't load transactions. Retry". It is
 * announced when it appears. `onRetry` refetches that part in the browser; `retrying` disables the button meanwhile.
 */
export function SectionError({ what, onRetry, retrying }: { what: string; onRetry: () => void; retrying?: boolean }) {
  return (
    <div className="notice notice--error" role="alert">
      <span className="notice__icon">
        <AlertIcon />
      </span>
      <div className="notice__body">Couldn&rsquo;t load {what}.</div>
      <button type="button" className="btn" onClick={onRetry} disabled={retrying}>
        {retrying ? "Retrying…" : "Retry"}
      </button>
    </div>
  );
}
