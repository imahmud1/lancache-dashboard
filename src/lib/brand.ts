import fs from "fs";
import path from "path";
import { dataDir } from "./data-file";

// Event-host branding. Everything is optional; the defaults keep the generic name.
//   BRAND_NAME     display name, e.g. "Summer LAN 2026"
//   BRAND_TAGLINE  short second line, e.g. "Hall B · Cache by LanCache"
//   BRAND_ACCENT   hex colour for live/interactive marks, e.g. "#ff6a3d"
//   logo           drop brand-logo.{svg,png,webp,jpg} into the data directory

export interface Brand {
  name: string;
  tagline: string;
  accent: string | null;
  logoUrl: string | null;
}

const DEFAULT_NAME = "LanCache";
const LOGO_TYPES: Record<string, string> = {
  svg: "image/svg+xml",
  png: "image/png",
  webp: "image/webp",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
};
const MAX_LOGO_BYTES = 2 * 1024 * 1024;

function clean(v: string | undefined, max: number): string {
  return (v ?? "").trim().slice(0, max);
}

function hue(hex: string): number {
  const h = hex.length === 4 ? hex.replace(/^#(.)(.)(.)$/, "#$1$1$2$2$3$3") : hex;
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255);
  const max = Math.max(r, g, b);
  const d = max - Math.min(r, g, b);
  if (d === 0) return -1; // grey: no hue to clash with
  const raw = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return (raw * 60 + 360) % 360;
}

// Cache green and internet amber carry meaning everywhere; warn when the host
// accent sits close enough to either to be mistaken for it.
const RESERVED_HUES = [
  { name: "cache green", hue: 128 },
  { name: "internet amber", hue: 40 },
];
let warnedFor = "";

function validAccent(v: string | undefined): string | null {
  const s = (v ?? "").trim();
  if (!/^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i.test(s)) return null;
  const h = hue(s);
  const clash = h < 0 ? null : RESERVED_HUES.find((r) => Math.min(Math.abs(h - r.hue), 360 - Math.abs(h - r.hue)) < 30);
  if (clash && warnedFor !== s) {
    warnedFor = s;
    console.warn(`[brand] BRAND_ACCENT ${s} is close to ${clash.name}; live marks may be mistaken for it. Consider another hue.`);
  }
  return s;
}

/** The logo file in the data dir, if one exists and is a sane size. */
export function findLogo(): { file: string; type: string; mtime: number } | null {
  const dir = dataDir();
  for (const ext of Object.keys(LOGO_TYPES)) {
    const file = path.join(/*turbopackIgnore: true*/ dir, `brand-logo.${ext}`);
    try {
      const st = fs.statSync(file);
      if (st.isFile() && st.size > 0 && st.size <= MAX_LOGO_BYTES) {
        return { file, type: LOGO_TYPES[ext], mtime: st.mtimeMs };
      }
    } catch {
      /* not present */
    }
  }
  return null;
}

export function getBrand(): Brand {
  const logo = findLogo();
  return {
    name: clean(process.env.BRAND_NAME, 60) || DEFAULT_NAME,
    tagline: clean(process.env.BRAND_TAGLINE, 80),
    accent: validAccent(process.env.BRAND_ACCENT),
    // mtime busts browser caches when the host swaps the file mid-event.
    logoUrl: logo ? `/api/brand/logo?v=${Math.round(logo.mtime)}` : null,
  };
}
