// Explorer persona — embeds the Planetary-Compute-Pro web app (OGE-OneGrid/webapp,
// a TanStack Start SSR app) as a first-class tab. The webapp keeps 100% of its own
// logic/routing/SSR; the report-app server reverse-proxies it under /webapp so the
// whole thing ships as ONE origin / ONE deployment. This component is just the frame.
import { useState } from 'react';

export default function Explorer({ theme }) {
  const [loaded, setLoaded] = useState(false);
  return (
    <div className="h-full w-full relative">
      {!loaded && (
        <div className="absolute inset-0 grid place-items-center pointer-events-none">
          <div className={`text-sm ${theme.sub || ''}`}>Loading Explorer…</div>
        </div>
      )}
      <iframe
        title="Weather & Asset Risk Explorer"
        src="/webapp/"
        onLoad={() => setLoaded(true)}
        className="absolute inset-0 w-full h-full border-0"
        // MapLibre/WebGL + same-origin (served via the /webapp reverse-proxy) need these.
        allow="geolocation; clipboard-read; clipboard-write"
      />
    </div>
  );
}
