// Post-processing composer, split into its own lazily-loaded chunk so the ~250KB
// `@react-three/postprocessing` bundle is NOT downloaded on a normal page load.
// Only imported when POSTFX_ENABLED (?fx=1) — see ../../lib/postfx.js.
import { Bloom, EffectComposer, Vignette } from "@react-three/postprocessing";

export default function PostFXComposer({ variant = "scene" }) {
  if (variant === "globe") {
    return (
      <EffectComposer disableNormalPass>
        <Bloom mipmapBlur intensity={0.55} luminanceThreshold={0.0} luminanceSmoothing={0.2} />
      </EffectComposer>
    );
  }
  return (
    <EffectComposer disableNormalPass>
      <Bloom mipmapBlur intensity={0.7} luminanceThreshold={0.42} luminanceSmoothing={0.28} />
      <Vignette eskil={false} offset={0.22} darkness={0.5} />
    </EffectComposer>
  );
}
