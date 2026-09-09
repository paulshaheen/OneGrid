// Global post-processing (bloom EffectComposer) switch for every R3F scene.
//
// DISABLED by default. On some GPUs — notably Snapdragon/Adreno via ANGLE→D3D — the
// postprocessing composer's offscreen HDR render target periodically hiccups and flashes
// the whole scene in bursts. Verified by bisection: any composer-based bloom flickers,
// while the identical scene without the composer is rock-solid. The holographic glow is
// carried by emissive/additive materials instead, which never flash.
//
// Set ?fx=1 in the URL to force-enable bloom on GPUs that handle it cleanly (?fx=0 or
// absent keeps it off).
export const POSTFX_ENABLED = (() => {
  try {
    if (typeof window === "undefined") return false;
    return new URLSearchParams(window.location.search).get("fx") === "1";
  } catch {
    return false;
  }
})();
