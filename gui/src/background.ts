/**
 * Animated background canvas — the "constellation" particle field.
 *
 * Wires up the dead `<canvas id="bg-canvas">` that the design always
 * anticipated (it sits at z-index 0, behind the CRT overlay at z-index 1).
 * Slow-moving accent-tinted dots connected by faint lines when close — the
 * classic ambient backdrop. Reads `--accent-rgb` from the CSS vars so it
 * recolors with the active theme automatically.
 *
 * Pauses when the tab is hidden to save battery. No deps beyond the DOM.
 */

import { readAccentRGB } from "./background-palette.js";

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
}

const PARTICLE_COUNT = 60;
const LINK_DIST = 140; // px — connect particles closer than this
const MAX_SPEED = 0.25; // px/frame — deliberately slow, ambient not distracting

export function initBackground(canvas: HTMLCanvasElement): () => void {
  const ctx = canvas.getContext("2d");
  if (!ctx) return () => {}; // headless / no 2d support — no-op teardown

  let w = 0;
  let h = 0;
  let dpr = window.devicePixelRatio || 1;
  let particles: Particle[] = [];
  let raf = 0;
  let running = true;

  function resize(): void {
    dpr = window.devicePixelRatio || 1;
    w = window.innerWidth;
    h = window.innerHeight;
    canvas.width = w * dpr;
    canvas.height = h * dpr;
    canvas.style.width = w + "px";
    canvas.style.height = h + "px";
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  function seed(): void {
    particles = Array.from({ length: PARTICLE_COUNT }, () => ({
      x: Math.random() * w,
      y: Math.random() * h,
      vx: (Math.random() - 0.5) * MAX_SPEED * 2,
      vy: (Math.random() - 0.5) * MAX_SPEED * 2,
    }));
  }

  function accent(): [number, number, number] {
    const v = getComputedStyle(document.documentElement).getPropertyValue("--accent-rgb").trim();
    return readAccentRGB(v);
  }

  function step(): void {
    if (!running) return;
    const [r, g, b] = accent();

    ctx.clearRect(0, 0, w, h);

    // Move + draw each particle.
    for (const p of particles) {
      p.x += p.vx;
      p.y += p.vy;
      // Wrap around edges so the field is seamless.
      if (p.x < 0) p.x = w;
      if (p.x > w) p.x = 0;
      if (p.y < 0) p.y = h;
      if (p.y > h) p.y = 0;

      ctx.beginPath();
      ctx.arc(p.x, p.y, 1.5, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(${r}, ${g}, ${b}, 0.5)`;
      ctx.fill();
    }

    // Connect nearby particles with faint lines.
    for (let i = 0; i < particles.length; i++) {
      for (let j = i + 1; j < particles.length; j++) {
        const dx = particles[i].x - particles[j].x;
        const dy = particles[i].y - particles[j].y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist < LINK_DIST) {
          const alpha = (1 - dist / LINK_DIST) * 0.15;
          ctx.beginPath();
          ctx.moveTo(particles[i].x, particles[i].y);
          ctx.lineTo(particles[j].x, particles[j].y);
          ctx.strokeStyle = `rgba(${r}, ${g}, ${b}, ${alpha})`;
          ctx.lineWidth = 1;
          ctx.stroke();
        }
      }
    }

    raf = requestAnimationFrame(step);
  }

  function onVisibility(): void {
    const wasRunning = running;
    running = !document.hidden;
    if (running && !wasRunning) {
      raf = requestAnimationFrame(step);
    } else if (!running && wasRunning) {
      cancelAnimationFrame(raf);
    }
  }

  resize();
  seed();
  raf = requestAnimationFrame(step);
  window.addEventListener("resize", resize);
  document.addEventListener("visibilitychange", onVisibility);

  // Teardown — removes listeners and cancels the loop.
  return () => {
    running = false;
    cancelAnimationFrame(raf);
    window.removeEventListener("resize", resize);
    document.removeEventListener("visibilitychange", onVisibility);
  };
}
