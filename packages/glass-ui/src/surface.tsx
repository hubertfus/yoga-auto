import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type CSSProperties,
  type ElementType,
  type HTMLAttributes,
  type KeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
  type Ref,
} from "react";
import { perfStore } from "./perf/store.ts";
import { surfaces } from "./perf/surfaceRegistry.ts";
import { refractFilters, type RefractHandle } from "./refraction/filters.ts";
import type { CardSize, Elevation, GlassTint, PerfTier } from "./types.ts";

export type SurfacePriority = "core" | "normal" | "low";
const PRIORITY: Record<SurfacePriority, number> = { core: 0, normal: 3, low: 5 };

type ExtraAttrs = {
  type?: "button" | "submit" | "reset";
  disabled?: boolean;
  [key: `data-${string}`]: string | number | boolean | undefined;
};

export interface GlassSurfaceProps
  extends Omit<HTMLAttributes<HTMLElement>, "children" | "className" | "style" | "onClick">,
    ExtraAttrs {
  as?: ElementType;
  radius?: "xs" | "sm" | "md" | "lg" | "xl" | "pill";
  elevation?: Elevation;
  refract?: boolean;
  tint?: GlassTint;
  className?: string;
  style?: CSSProperties;
  children?: ReactNode;
  onClick?: () => void;
  /**
   * Ważność przy limicie powierzchni z backdrop-filter. `core` (Dock, Sheet) dostaje szkło jako pierwsze
   * i refrakcję już w tierze `high`. Domyślnie `normal`.
   */
  priority?: SurfacePriority;
  /** `false` = sama półprzezroczysta wypełnka bez backdrop-filter (tanie; nie liczy się do limitu) */
  backdrop?: boolean;
  ref?: Ref<HTMLElement>;
}

const selectTier = (): PerfTier => perfStore.getSnapshot().tier;

/** Czy ta powierzchnia ma dostać prawdziwe szkło (limit powierzchni per tier). */
function useGlassSlot(el: React.RefObject<HTMLElement | null>, backdrop: boolean, priority: number): boolean {
  const [id] = useState(() => surfaces.allocId());
  useLayoutEffect(() => {
    if (!backdrop) return;
    return surfaces.register(id, priority);
  }, [id, backdrop, priority]);
  useEffect(() => {
    const node = el.current;
    if (!backdrop || !node || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver((entries) => {
      const last = entries[entries.length - 1];
      if (last) surfaces.update(id, { visible: last.isIntersecting });
    });
    io.observe(node);
    return () => io.disconnect();
  }, [id, backdrop, el]);
  return useSyncExternalStore(
    surfaces.subscribe,
    () => backdrop && surfaces.isGlass(id),
    () => backdrop,
  );
}

function resolveRadiusPx(el: HTMLElement, w: number, h: number): number {
  const raw = getComputedStyle(el).borderTopLeftRadius.split(" ")[0] ?? "0";
  const max = Math.min(w, h) / 2;
  const v = raw.endsWith("%") ? (parseFloat(raw) / 100) * Math.min(w, h) : parseFloat(raw);
  return Math.max(0, Math.min(Number.isFinite(v) ? v : 0, max));
}

/**
 * Refrakcja: mierzy element (ResizeObserver z debounce), bierze/generuje mapę przemieszczeń z cache
 * i ustawia `--lg-refract-url` DOPIERO po wstawieniu filtra do DOM. Zwraca true, gdy filtr jest aktywny.
 */
function useRefraction(el: React.RefObject<HTMLElement | null>, enabled: boolean): boolean {
  const [ready, setReady] = useState(false);
  useLayoutEffect(() => {
    const node = el.current;
    if (!enabled || !node) {
      setReady(false);
      return;
    }
    let handle: RefractHandle | null = null;
    let timer = 0;
    let disposed = false;
    const apply = () => {
      const w = node.offsetWidth;
      const h = node.offsetHeight;
      if (w < 8 || h < 8) return;
      const r = resolveRadiusPx(node, w, h);
      const next = refractFilters.acquire(w, h, r);
      node.style.setProperty("--lg-refract-url", next.url);
      handle?.release();
      handle = next;
      if (!disposed) setReady(true);
    };
    apply();
    const ro = new ResizeObserver(() => {
      clearTimeout(timer);
      timer = window.setTimeout(apply, 120);
    });
    ro.observe(node);
    return () => {
      disposed = true;
      clearTimeout(timer);
      ro.disconnect();
      node.style.removeProperty("--lg-refract-url");
      handle?.release();
      setReady(false);
    };
  }, [enabled, el]);
  return ready;
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
  priority = "normal",
  backdrop = true,
  ref,
  ...rest
}: GlassSurfaceProps) {
  const local = useRef<HTMLElement | null>(null);
  const setRef = useCallback(
    (node: HTMLElement | null) => {
      local.current = node;
      if (typeof ref === "function") ref(node);
      else if (ref) (ref as { current: HTMLElement | null }).current = node;
    },
    [ref],
  );
  const tier = useSyncExternalStore(perfStore.subscribe, selectTier, selectTier);
  const isGlass = useGlassSlot(local, backdrop, PRIORITY[priority]);
  const wantRefract = refract && isGlass && (tier === "ultra" || (tier === "high" && priority === "core"));
  const refractReady = useRefraction(local, wantRefract);

  return (
    <As
      {...rest}
      ref={setRef}
      className={`lg-surface ${className}`}
      data-elevation={elevation}
      data-tint={tint}
      data-glass={backdrop ? (isGlass ? "on" : "off") : "fill"}
      data-refract={refractReady ? "on" : undefined}
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
  /** opcjonalne: przekazywane do prymitywu */
  elevation?: Elevation;
  tint?: GlassTint;
  radius?: GlassSurfaceProps["radius"];
  style?: CSSProperties;
  children?: ReactNode;
}

export function GlassPanel({ title, padding = 16, className, elevation, tint, radius, style, children }: GlassPanelProps) {
  return (
    <GlassSurface
      className={`lg-panel ${className ?? ""}`}
      style={{ padding, ...style }}
      {...(elevation ? { elevation } : {})}
      {...(tint ? { tint } : {})}
      {...(radius ? { radius } : {})}
    >
      {title ? <div className="lg-panel__title">{title}</div> : null}
      {children}
    </GlassSurface>
  );
}

export interface GlassCardProps {
  size?: CardSize;
  accent?: string;
  onPress?: () => void;
  /** M4: edycja układu — wywoływane po przytrzymaniu ≥ 450 ms (bez ruchu > 10 px) */
  onLongPress?: () => void;
  className?: string;
  children?: ReactNode;
}

/** Próg long-pressa (DESIGN.md §7). */
export const LONG_PRESS_MS = 450;
const MOVE_TOLERANCE = 10;

export function GlassCard({ size = "1x1", accent, onPress, onLongPress, className, children }: GlassCardProps) {
  const [w, h] = size.split("x").map(Number) as [number, number];
  const style: CSSProperties = { gridColumn: `span ${w}`, gridRow: `span ${h}` };
  if (accent) (style as Record<string, string>)["--card-accent"] = accent;
  const timer = useRef(0);
  const origin = useRef<{ x: number; y: number } | null>(null);
  const longFired = useRef(false);
  const interactive = Boolean(onPress || onLongPress);

  const clear = () => {
    clearTimeout(timer.current);
    timer.current = 0;
    origin.current = null;
  };
  useEffect(() => clear, []);

  const onPointerDown = (e: ReactPointerEvent) => {
    longFired.current = false;
    if (!onLongPress) return;
    origin.current = { x: e.clientX, y: e.clientY };
    timer.current = window.setTimeout(() => {
      longFired.current = true;
      origin.current = null;
      onLongPress();
    }, LONG_PRESS_MS);
  };
  const onPointerMove = (e: ReactPointerEvent) => {
    const o = origin.current;
    if (o && Math.hypot(e.clientX - o.x, e.clientY - o.y) > MOVE_TOLERANCE) clear();
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      onPress?.();
    }
  };

  return (
    <GlassSurface
      className={`lg-card ${className ?? ""}`}
      style={style}
      data-interactive={interactive || undefined}
      {...(interactive ? { role: "button", tabIndex: 0, onKeyDown: onKey } : {})}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={clear}
      onPointerCancel={clear}
      onContextMenu={(e) => e.preventDefault()}
      // po przytrzymaniu (edycja układu) puszczenie palca nie może „kliknąć” przycisku w środku kafla
      onClickCapture={(e: { stopPropagation(): void }) => {
        if (longFired.current) {
          longFired.current = false;
          e.stopPropagation();
        }
      }}
      onClick={() => onPress?.()}
    >
      {children}
    </GlassSurface>
  );
}
