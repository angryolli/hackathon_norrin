"use client";

import { useEffect, useRef } from "react";

type Props = {
  values: number[];
  tick?: number;
  className?: string;
  limit?: number;
  accent?: string;
};

type Sample = { i: number; v: number };

function formatTick(n: number) {
  const a = Math.abs(n);
  if (a >= 100) return n.toFixed(0);
  if (a >= 10) return n.toFixed(1);
  return n.toFixed(2);
}

function lerp(a: number, b: number, t: number) {
  return a + (b - a) * t;
}

function tracePath(
  ctx: CanvasRenderingContext2D,
  pts: { x: number; y: number }[],
) {
  if (!pts.length) return;
  ctx.moveTo(pts[0].x, pts[0].y);
  if (pts.length === 2) {
    ctx.lineTo(pts[1].x, pts[1].y);
    return;
  }
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[Math.max(0, i - 1)];
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const p3 = pts[Math.min(pts.length - 1, i + 2)];
    ctx.bezierCurveTo(
      p1.x + (p2.x - p0.x) / 6,
      p1.y + (p2.y - p0.y) / 6,
      p2.x - (p3.x - p1.x) / 6,
      p2.y - (p3.y - p1.y) / 6,
      p2.x,
      p2.y,
    );
  }
}

export function SensorChart({
  values,
  tick,
  className = "",
  limit,
  accent = "rgb(82, 82, 91)",
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const samplesRef = useRef<Sample[]>([]);
  const nextIndexRef = useRef(0);
  const lastTickRef = useRef<number | null>(null);
  const playheadRef = useRef(0);
  const inkRef = useRef(1);
  const lastFrameRef = useRef(0);
  const historyRef = useRef(100);
  const rafRef = useRef(0);

  useEffect(() => {
    historyRef.current = 100;
    const samples = samplesRef.current;
    if (!values.length) {
      samples.length = 0;
      nextIndexRef.current = 0;
      lastTickRef.current = tick ?? null;
      playheadRef.current = 0;
      inkRef.current = 1;
      return;
    }

    const incomingTick = tick ?? lastTickRef.current ?? 0;
    if (samples.length === 0) {
      samples.push(...values.map((v, i) => ({ i, v })));
      nextIndexRef.current = values.length;
      lastTickRef.current = incomingTick;
      playheadRef.current = Math.max(0, values.length - 1);
      inkRef.current = 1;
      return;
    }

    if (tick != null && lastTickRef.current != null && tick < lastTickRef.current) {
      samples.length = 0;
      samples.push(...values.map((v, i) => ({ i, v })));
      nextIndexRef.current = values.length;
      lastTickRef.current = tick;
      playheadRef.current = Math.max(0, values.length - 1);
      inkRef.current = 1;
      return;
    }

    if (tick != null && tick === lastTickRef.current) return;

    const prevTick = lastTickRef.current;
    const addedCount =
      tick != null && prevTick != null
        ? Math.min(values.length, Math.max(1, tick - prevTick))
        : 1;
    const added = values.slice(Math.max(0, values.length - addedCount));
    for (const v of added) {
      samples.push({ i: nextIndexRef.current, v });
      nextIndexRef.current += 1;
    }
    inkRef.current = 0;
    lastTickRef.current = tick ?? (prevTick ?? 0) + addedCount;
    const keep = historyRef.current + 16;
    if (samples.length > keep) samples.splice(0, samples.length - keep);
  }, [values, tick]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const wrap = wrapRef.current;
    if (!canvas || !wrap) return;

    const ctx = canvas.getContext("2d", {
      alpha: true,
      desynchronized: true,
    });
    if (!ctx) return;

    lastFrameRef.current = performance.now();

    const draw = (now: number) => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const cssW = wrap.clientWidth || 320;
      const cssH = wrap.clientHeight || 96;
      if (canvas.width !== Math.floor(cssW * dpr) || canvas.height !== Math.floor(cssH * dpr)) {
        canvas.width = Math.floor(cssW * dpr);
        canvas.height = Math.floor(cssH * dpr);
        canvas.style.width = `${cssW}px`;
        canvas.style.height = `${cssH}px`;
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, cssW, cssH);

      const dt = Math.min(0.05, Math.max(0, (now - lastFrameRef.current) / 1000));
      lastFrameRef.current = now;

      const samples = samplesRef.current;
      const latest = samples.length ? samples[samples.length - 1].i : 0;
      const history = historyRef.current;
      const headroom = 10;
      const windowSize = history + headroom;
      const minPlay = latest + 6;
      const maxPlay = latest + headroom;
      playheadRef.current += dt * 2.2;
      if (playheadRef.current < minPlay) {
        playheadRef.current = lerp(playheadRef.current, minPlay, 0.14);
      }
      playheadRef.current = Math.min(playheadRef.current, maxPlay);
      inkRef.current = Math.min(1, inkRef.current + dt * 3.2);

      const padL = 40;
      const padR = 12;
      const padT = 10;
      const padB = 18;
      const plotW = Math.max(1, cssW - padL - padR);
      const plotH = Math.max(1, cssH - padT - padB);
      const rightIndex = Math.max(playheadRef.current, windowSize);
      const leftIndex = rightIndex - windowSize;

      const visible: Sample[] = [];
      for (const s of samples) {
        if (s.i >= leftIndex - 1 && s.i <= rightIndex + 1) visible.push(s);
      }

      const ink = inkRef.current;
      const drawn: { i: number; v: number }[] = [];
      for (let k = 0; k < visible.length; k++) {
        const s = visible[k];
        const isLast = s.i === latest && visible.length > 1 && ink < 1;
        if (isLast) {
          const prev = visible[k - 1] ?? s;
          drawn.push({ i: lerp(prev.i, s.i, ink), v: lerp(prev.v, s.v, ink) });
        } else {
          drawn.push(s);
        }
      }

      const series = drawn.length ? drawn : [{ i: 0, v: 0 }];
      let min = Math.min(...series.map((s) => s.v));
      let max = Math.max(...series.map((s) => s.v));
      if (limit !== undefined) {
        min = Math.min(min, limit);
        max = Math.max(max, limit);
      }
      if (max - min < 1e-6) {
        min -= 1;
        max += 1;
      }
      const padY = (max - min) * 0.45;
      min -= padY;
      max += padY;
      const span = max - min;
      const xOf = (i: number) => padL + ((i - leftIndex) / windowSize) * plotW;
      const yOf = (v: number) => padT + (1 - (v - min) / span) * plotH;

      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = "high";

      ctx.save();
      ctx.beginPath();
      ctx.rect(padL, padT, plotW, plotH);
      ctx.clip();

      ctx.strokeStyle = "rgba(255,255,255,0.08)";
      ctx.lineWidth = 1;
      const yTicks = 4;
      for (let i = 0; i <= yTicks; i++) {
        const y = padT + (i / yTicks) * plotH;
        ctx.beginPath();
        ctx.moveTo(padL, y);
        ctx.lineTo(cssW - padR, y);
        ctx.stroke();
      }

      if (limit !== undefined) {
        const y = yOf(limit);
        ctx.setLineDash([4, 4]);
        ctx.strokeStyle = "rgba(161,161,170,0.7)";
        ctx.beginPath();
        ctx.moveTo(padL, y);
        ctx.lineTo(cssW - padR, y);
        ctx.stroke();
        ctx.setLineDash([]);
      }

      const pts = series.map((s) => ({ x: xOf(s.i), y: yOf(s.v) }));
      if (pts.length) {
        ctx.beginPath();
        tracePath(ctx, pts);
        ctx.strokeStyle = accent;
        ctx.lineWidth = 1.25;
        ctx.lineJoin = "round";
        ctx.lineCap = "round";
        ctx.stroke();
      }
      ctx.restore();

      ctx.font = "10px ui-monospace, SFMono-Regular, Menlo, monospace";
      ctx.fillStyle = "rgba(161,161,170,0.9)";
      ctx.textAlign = "right";
      ctx.textBaseline = "middle";
      for (let i = 0; i <= yTicks; i++) {
        const t = max - (span * i) / yTicks;
        const y = padT + (i / yTicks) * plotH;
        ctx.fillText(formatTick(t), padL - 6, y);
      }

      ctx.textAlign = "center";
      ctx.textBaseline = "top";
      const xCount = 5;
      for (let i = 0; i < xCount; i++) {
        const frac = i / (xCount - 1);
        const idx = leftIndex + frac * windowSize;
        const x = padL + frac * plotW;
        ctx.fillText(String(Math.max(0, Math.round(idx))), x, cssH - padB + 4);
      }

      rafRef.current = requestAnimationFrame(draw);
    };

    rafRef.current = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(rafRef.current);
  }, [accent, limit]);

  return (
    <div
      ref={wrapRef}
      className={`gpu-layer relative w-full ${className}`}
      style={{
        transform: "translate3d(0,0,0)",
        backfaceVisibility: "hidden",
        willChange: "transform",
      }}
    >
      <canvas
        ref={canvasRef}
        className="block h-full w-full"
        style={{
          transform: "translate3d(0,0,0)",
          willChange: "transform",
        }}
      />
    </div>
  );
}
