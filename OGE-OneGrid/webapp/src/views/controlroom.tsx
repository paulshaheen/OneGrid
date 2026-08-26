import { useEffect, useRef, useState } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import { ContactShadows, OrbitControls } from "@react-three/drei";
import * as THREE from "three";
import { Activity, Cpu } from "lucide-react";

import { AppShell, PageHeader } from "@/components/ops/AppShell";

// P3: a real react-three-fiber 3D digital twin (fiber@9 / drei@10 on React 19).
// A compressor skid you can orbit, with an anomaly pulse pinned to the bearing.
// Sample telemetry until wired to the live WebSocket in P2.
const TELEMETRY = [
  { k: "Vibration", v: "7.8 mm/s", tone: "high", state: "high" },
  { k: "Bearing temp", v: "96 °C", tone: "monitor", state: "watch" },
  { k: "Discharge press", v: "61 bar", tone: "normal", state: "ok" },
  { k: "Flow", v: "12,400 m³/h", tone: "normal", state: "ok" },
  { k: "Speed", v: "8,950 rpm", tone: "normal", state: "ok" },
];
const TONE: Record<string, string> = {
  high: "bg-risk-high/20 text-risk-high",
  monitor: "bg-risk-monitor/20 text-risk-monitor",
  normal: "bg-muted text-muted-foreground",
};

function metal(color: string, m = 0.45, r = 0.5) {
  return <meshStandardMaterial color={color} metalness={m} roughness={r} />;
}

function CompressorSkid() {
  return (
    <group position={[0, 0.35, 0]} rotation={[0, -0.5, 0]}>
      {/* base skid */}
      <mesh position={[0, -0.5, 0]} receiveShadow castShadow>
        <boxGeometry args={[4.4, 0.3, 1.9]} />
        {metal("#39445a", 0.5, 0.55)}
      </mesh>
      {/* motor */}
      <mesh position={[-1.25, 0.15, 0]} castShadow>
        <boxGeometry args={[1.4, 1.05, 1.05]} />
        {metal("#5b6675", 0.55, 0.4)}
      </mesh>
      {/* coupling */}
      <mesh position={[-0.4, 0.15, 0]} rotation={[0, 0, Math.PI / 2]} castShadow>
        <cylinderGeometry args={[0.14, 0.14, 0.55, 24]} />
        {metal("#8b98a9", 0.7, 0.3)}
      </mesh>
      {/* bearing housing (anomaly zone) */}
      <mesh position={[-0.02, 0.15, 0]} rotation={[0, 0, Math.PI / 2]} castShadow>
        <cylinderGeometry args={[0.24, 0.24, 0.34, 24]} />
        {metal("#9aa6b6", 0.7, 0.25)}
      </mesh>
      {/* compressor body */}
      <mesh position={[0.95, 0.2, 0]} rotation={[0, 0, Math.PI / 2]} castShadow>
        <cylinderGeometry args={[0.62, 0.62, 1.9, 40]} />
        {metal("#6b7686", 0.5, 0.35)}
      </mesh>
      {/* end cap */}
      <mesh position={[1.95, 0.2, 0]} rotation={[0, 0, Math.PI / 2]} castShadow>
        <cylinderGeometry args={[0.66, 0.66, 0.18, 40]} />
        {metal("#7c8797", 0.6, 0.3)}
      </mesh>
      {/* piping */}
      <mesh position={[1.7, 0.85, 0.45]} rotation={[Math.PI / 2, 0, 0]}>
        <cylinderGeometry args={[0.09, 0.09, 1.4, 16]} />
        {metal("#465063", 0.6, 0.45)}
      </mesh>
      <mesh position={[1.7, 0.85, -0.45]} rotation={[Math.PI / 2, 0, 0]}>
        <cylinderGeometry args={[0.09, 0.09, 1.4, 16]} />
        {metal("#465063", 0.6, 0.45)}
      </mesh>
    </group>
  );
}

function AnomalyPulse() {
  const ref = useRef<THREE.Mesh>(null);
  useFrame(({ clock }) => {
    const t = clock.getElapsedTime();
    if (ref.current) {
      ref.current.scale.setScalar(1 + Math.sin(t * 3) * 0.22);
      (ref.current.material as THREE.MeshBasicMaterial).opacity =
        0.28 + (Math.sin(t * 3) + 1) * 0.12;
    }
  });
  // bearing zone is at group offset (~ -0.02, 0.5, 0) in world space after skid transform
  return (
    <group position={[0.05, 0.5, 0.35]}>
      <mesh ref={ref}>
        <sphereGeometry args={[0.5, 24, 24]} />
        <meshBasicMaterial color="#ff5a5f" transparent opacity={0.35} depthWrite={false} />
      </mesh>
      <pointLight color="#ff7a5f" intensity={2.2} distance={3} />
    </group>
  );
}

function Scene() {
  return (
    <>
      <color attach="background" args={["#0a1020"]} />
      <hemisphereLight args={["#a7c4ee", "#141b2b", 1.1]} />
      <ambientLight intensity={0.5} />
      <directionalLight
        position={[5, 7, 4]}
        intensity={1.8}
        castShadow
        shadow-mapSize={[1024, 1024]}
      />
      <directionalLight position={[-4, 4, 6]} intensity={0.8} />
      <pointLight position={[-4, 3, -3]} color="#2b88d8" intensity={1.8} />
      <CompressorSkid />
      <AnomalyPulse />
      <ContactShadows position={[0, -0.16, 0]} opacity={0.5} blur={2.6} scale={9} far={4} />
      <OrbitControls
        autoRotate
        autoRotateSpeed={0.7}
        enablePan={false}
        minDistance={4.5}
        maxDistance={12}
        maxPolarAngle={Math.PI / 2.05}
      />
    </>
  );
}

export function ControlRoomPage() {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  return (
    <AppShell>
      <PageHeader
        title="Control Room"
        description="Live 3D digital twin streaming historian values, with anomalies pinned to the exact physical zone."
      />
      <div className="grid gap-4 p-5 lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
        <div className="relative h-[460px] overflow-hidden rounded-lg border bg-surface-raised">
          {mounted ? (
            <Canvas shadows camera={{ position: [5.5, 3, 6.5], fov: 42 }} dpr={[1, 2]}>
              <Scene />
            </Canvas>
          ) : (
            <div className="grid h-full place-items-center text-sm text-muted-foreground">
              Loading 3D twin…
            </div>
          )}
          <div className="pointer-events-none absolute bottom-3 left-3 rounded-md border bg-card/80 px-2.5 py-1.5 text-[11px] text-muted-foreground backdrop-blur">
            Compressor B · live twin · drag to orbit
          </div>
        </div>

        <div className="space-y-4">
          <div className="rounded-lg border bg-card">
            <div className="flex items-center justify-between border-b px-4 py-3">
              <div className="flex items-center gap-2 text-[13px] font-semibold">
                <Cpu className="size-4 text-primary" /> Compressor B
              </div>
              <span className="rounded-full bg-risk-high/20 px-2 py-0.5 text-[11px] font-semibold text-risk-high">
                anomaly
              </span>
            </div>
            <ul>
              {TELEMETRY.map((t) => (
                <li
                  key={t.k}
                  className="flex items-center gap-3 border-t px-4 py-2.5 text-[13px] first:border-t-0"
                >
                  <Activity className="size-3.5 text-muted-foreground" />
                  <span className="flex-1">{t.k}</span>
                  <span className="num">{t.v}</span>
                  <span
                    className={`w-14 rounded-full px-2 py-0.5 text-center text-[11px] font-semibold ${TONE[t.tone]}`}
                  >
                    {t.state}
                  </span>
                </li>
              ))}
            </ul>
          </div>
          <div className="rounded-lg border bg-card p-4">
            <div className="mb-1 text-[13px] font-semibold">Root cause</div>
            <p className="text-[13px] text-muted-foreground">
              Stop model predicts a trip in ~26h; the survival model attributes it to bearing wear.
              Recommend inspection at the next weather window (T-72h).
            </p>
          </div>
        </div>
      </div>
    </AppShell>
  );
}
