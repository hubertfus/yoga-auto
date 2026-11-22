import type { CSSProperties, ElementType, ReactNode } from "react";
import type { CardSize, Elevation, GlassTint } from "./types.ts";

export interface GlassSurfaceProps {
  as?: ElementType;
  radius?: "xs" | "sm" | "md" | "lg" | "xl" | "pill";
  elevation?: Elevation;
  refract?: boolean;
  tint?: GlassTint;
  className?: string;
  style?: CSSProperties;
  children?: ReactNode;
  onClick?: () => void;
}

export function GlassSurface({
  as: As = "div",
  radius = "lg",
  elevation = 1,
  refract = false,
  tint = "default",
  className = "",
  style,
  children,
  onClick,
}: GlassSurfaceProps) {
  return (
    <As
      className={`lg-surface ${className}`}
      data-elevation={elevation}
      data-tint={tint}
      data-refract={refract || undefined}
      style={{ borderRadius: `var(--r-${radius})`, ...style }}
      onClick={onClick}
    >
      {children}
    </As>
  );
}

export interface GlassPanelProps {
  title?: ReactNode;
  padding?: number;
  className?: string;
  children?: ReactNode;
}

export function GlassPanel({ title, padding = 16, className, children }: GlassPanelProps) {
  return (
    <GlassSurface className={`lg-panel ${className ?? ""}`} style={{ padding }}>
      {title ? <div className="lg-panel__title">{title}</div> : null}
      {children}
    </GlassSurface>
  );
}

export interface GlassCardProps {
  size?: CardSize;
  accent?: string;
  onPress?: () => void;
  /** M4: edycja układu */
  onLongPress?: () => void;
  children?: ReactNode;
}

export function GlassCard({ size = "1x1", accent, onPress, children }: GlassCardProps) {
  const [w, h] = size.split("x").map(Number) as [number, number];
  const style: CSSProperties = { gridColumn: `span ${w}`, gridRow: `span ${h}` };
  if (accent) (style as Record<string, string>)["--card-accent"] = accent;
  return (
    <GlassSurface className="lg-card" onClick={onPress} style={style}>
      {children}
    </GlassSurface>
  );
}
