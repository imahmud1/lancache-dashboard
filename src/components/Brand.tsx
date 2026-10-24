"use client";

import { useEffect, useState } from "react";

export interface BrandInfo {
  name: string;
  tagline: string;
  accent: string | null;
  logoUrl: string | null;
}

/** Loads host branding once and applies BRAND_ACCENT to the page's accent token. */
export function useBrand(): BrandInfo | null {
  const [brand, setBrand] = useState<BrandInfo | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/brand")
      .then((r) => r.json())
      .then((b: BrandInfo) => {
        if (cancelled) return;
        setBrand(b);
        if (b.accent) document.documentElement.style.setProperty("--brand-accent", b.accent);
        if (b.name) document.title = b.name === "LanCache" ? "LanCache Dashboard" : `${b.name} · LanCache`;
      })
      .catch(() => {
        if (!cancelled) setBrand({ name: "LanCache", tagline: "", accent: null, logoUrl: null });
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return brand;
}

/**
 * The host's logo when one is configured, otherwise the name set as type.
 * `size` is the logo height; the name scales with it.
 */
export function BrandMark({ brand, className = "", logoClassName = "h-7" }: { brand: BrandInfo | null; className?: string; logoClassName?: string }) {
  if (!brand) return <div className={`h-7 w-32 rounded bg-raised animate-pulse ${className}`} aria-hidden />;

  return (
    <div className={`flex items-center gap-3 min-w-0 ${className}`}>
      {brand.logoUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={brand.logoUrl} alt={brand.name} className={`${logoClassName} w-auto max-w-[14rem] object-contain`} />
      ) : (
        <CacheGlyph className={logoClassName} />
      )}
      {(!brand.logoUrl || brand.tagline) && (
        <div className="min-w-0 leading-tight">
          {!brand.logoUrl && <div className="font-display [font-stretch:90%] text-[1.05em] font-semibold tracking-tight text-ink truncate">{brand.name}</div>}
          {brand.tagline && <div className="text-[0.72em] text-ink-3 truncate">{brand.tagline}</div>}
        </div>
      )}
    </div>
  );
}

/** Default mark: a cache split, drawn. Green share = served locally. */
function CacheGlyph({ className = "" }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={`${className} w-auto shrink-0`} aria-hidden>
      <circle cx="16" cy="16" r="12" fill="none" stroke="var(--color-line-strong)" strokeWidth="5" />
      <circle
        cx="16"
        cy="16"
        r="12"
        fill="none"
        stroke="var(--color-cache)"
        strokeWidth="5"
        strokeDasharray={`${2 * Math.PI * 12 * 0.68} ${2 * Math.PI * 12}`}
        transform="rotate(-90 16 16)"
      />
    </svg>
  );
}
