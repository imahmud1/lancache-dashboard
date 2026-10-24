import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Display · LanCache",
  description: "Fullscreen 16:9 LanCache event display",
};

export default function DisplayLayout({ children }: { children: React.ReactNode }) {
  return children;
}
