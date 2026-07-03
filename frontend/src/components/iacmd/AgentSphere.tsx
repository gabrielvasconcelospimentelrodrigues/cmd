import { useEffect, useRef } from 'react';

/**
 * Esfera de malha do "Agente de IA".
 *  - inativa: pontos numa esfera girando devagar.
 *  - ativa: metamórfica — gira mais rápido e os pontos pulsam/deformam.
 */
export function AgentSphere({ active, size = 160 }: { active?: boolean; size?: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const activeRef = useRef(!!active);
  activeRef.current = !!active;

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = size * dpr;
    canvas.height = size * dpr;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.scale(dpr, dpr);

    // Pontos distribuídos na esfera (espiral de Fibonacci).
    const N = 280;
    const inc = Math.PI * (3 - Math.sqrt(5));
    const pts: { x: number; y: number; z: number; ph: number }[] = [];
    for (let i = 0; i < N; i++) {
      const y = 1 - (i / (N - 1)) * 2;
      const r = Math.sqrt(Math.max(0, 1 - y * y));
      const phi = i * inc;
      pts.push({ x: Math.cos(phi) * r, y, z: Math.sin(phi) * r, ph: (i % 13) / 13 });
    }

    const R = size * 0.42;
    const cx = size / 2;
    const cy = size / 2;
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    let raf = 0;
    let angY = 0;
    let angX = 0;
    let t = 0;

    const frame = () => {
      const act = activeRef.current;
      angY += act ? 0.014 : 0.006;
      angX += act ? 0.006 : 0.0;
      t += 0.04;
      const cosY = Math.cos(angY), sinY = Math.sin(angY);
      const cosX = Math.cos(angX), sinX = Math.sin(angX);
      const amp = act ? 0.16 : 0; // deformação metamórfica só quando ativa
      const wobble = act ? Math.sin(t * 0.7) * 0.06 : 0;

      ctx.clearRect(0, 0, size, size);
      for (const p of pts) {
        const rr = 1 + amp * Math.sin(t * 2.2 + p.ph * 6.283 + (p.y + p.x) * 3) + wobble;
        let X = p.x * rr, Y = p.y * rr, Z = p.z * rr;
        // rotação Y
        let x = X * cosY - Z * sinY;
        let z = X * sinY + Z * cosY;
        // rotação X (leve, só ativa)
        const y = Y * cosX - z * sinX;
        z = Y * sinX + z * cosX;
        x = x;
        const sx = cx + x * R;
        const sy = cy + y * R;
        const depth = (z + 1) / 2; // 0 (fundo) .. 1 (frente)
        const rad = 0.8 + depth * 1.8;
        ctx.beginPath();
        ctx.arc(sx, sy, rad, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(59,130,246,${(0.18 + depth * 0.62).toFixed(3)})`;
        ctx.fill();
      }
      if (!reduce) raf = requestAnimationFrame(frame);
    };
    frame();
    return () => cancelAnimationFrame(raf);
  }, [size]);

  return <canvas ref={ref} style={{ width: size, height: size, display: 'block' }} />;
}
