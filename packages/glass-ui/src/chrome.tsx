import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, animate, motion, useDragControls, useMotionValue, useReducedMotion, type PanInfo } from "motion/react";
import { springs } from "@yoga-auto/design-tokens";
import { Icon } from "./gauges.tsx";
import { GlassSurface } from "./surface.tsx";
import type { ToastLevel } from "./types.ts";

export interface DockItem {
  id: string;
  icon: ReactNode;
  label: string;
  badge?: number | string;
}

export interface DockProps {
  items: readonly DockItem[];
  active: string;
  onSelect(id: string): void;
  position?: "left" | "bottom";
}

/**
 * Dock w stylu CarPlay: szkło z refrakcją od tieru `high` (priorytet `core` — pierwszy w limicie powierzchni).
 * Wskaźnik aktywnej pozycji przesuwa się sprężyną CSS (transform), nigdy rozmiarem.
 */
export function Dock({ items, active, onSelect, position = "left" }: DockProps) {
  const index = Math.max(0, items.findIndex((i) => i.id === active));
  return (
    <GlassSurface
      as="nav"
      radius="xl"
      elevation={2}
      refract
      priority="core"
      className="lg-dock"
      data-position={position}
      aria-label="Nawigacja"
      style={{ "--i": index, "--n": items.length } as CSSProperties}
    >
      <span className="lg-dock__thumb" aria-hidden />
      {items.map((i) => (
        <button
          key={i.id}
          type="button"
          className="lg-dock__item"
          data-active={i.id === active || undefined}
          aria-label={i.label}
          aria-current={i.id === active ? "page" : undefined}
          onClick={() => onSelect(i.id)}
        >
          {i.icon}
          {i.badge != null ? <span className="lg-dock__badge">{i.badge}</span> : null}
        </button>
      ))}
    </GlassSurface>
  );
}

export type SheetDetent = "medium" | "large";

export interface SheetProps {
  open: boolean;
  onClose(): void;
  detents?: readonly SheetDetent[];
  title?: ReactNode;
  children?: ReactNode;
}

const DETENT_FRACTION: Record<SheetDetent, number> = { medium: 0.55, large: 0.92 };
const spring = (name: keyof typeof springs) => ({ type: "spring" as const, ...springs[name] });

function useViewportHeight(): number {
  const [h, setH] = useState(() => (typeof window === "undefined" ? 800 : window.innerHeight));
  useEffect(() => {
    const on = () => setH(window.innerHeight);
    window.addEventListener("resize", on);
    return () => window.removeEventListener("resize", on);
  }, []);
  return h;
}

/**
 * Sheet z detentami (`medium` 55%, `large` 92% wysokości), przeciąganiem za uchwyt/nagłówek
 * (drag-to-dismiss: szybkie lub głębokie pociągnięcie w dół zamyka, w górę rozwija do `large`),
 * sprężyną `gentle` i przyciemnionym tłem. `prefers-reduced-motion` → crossfade.
 */
export function Sheet({ open, onClose, detents = ["medium", "large"], title, children }: SheetProps) {
  if (typeof document === "undefined") return null;
  return createPortal(
    <AnimatePresence>
      {open ? <SheetInner key="sheet" onClose={onClose} detents={detents} title={title} children={children} /> : null}
    </AnimatePresence>,
    document.body,
  );
}

function SheetInner({
  onClose,
  detents,
  title,
  children,
}: Pick<SheetProps, "onClose" | "title" | "children"> & { detents: readonly SheetDetent[] }) {
  const reduce = useReducedMotion();
  const vh = useViewportHeight();
  const sorted = [...detents].sort((a, b) => DETENT_FRACTION[a] - DETENT_FRACTION[b]);
  const height = Math.round(vh * DETENT_FRACTION[sorted[sorted.length - 1] ?? "large"]);
  /** offset translateY dla danego detentu (0 = w pełni rozwinięty) */
  const offsets = sorted.map((d) => height - Math.round(vh * DETENT_FRACTION[d]));
  const y = useMotionValue(reduce ? offsets[0] ?? 0 : height);
  const controls = useDragControls();
  const panel = useRef<HTMLDivElement>(null);
  const current = useRef(offsets[0] ?? 0);

  const goTo = useCallback(
    (target: number) => {
      current.current = target;
      if (reduce) y.set(target);
      else animate(y, target, spring("gentle"));
    },
    [reduce, y],
  );

  useEffect(() => {
    goTo(offsets[0] ?? 0);
    panel.current?.focus({ preventScroll: true });
    // tylko przy montowaniu / zmianie wysokości okna
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [height]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const onDragEnd = (_: unknown, info: PanInfo) => {
    const projected = y.get() + info.velocity.y * 0.18;
    const closeAt = height - (height - (offsets[0] ?? 0)) * 0.5;
    if (projected > closeAt || info.velocity.y > 900) {
      onClose();
      return;
    }
    const nearest = offsets.reduce((best, o) => (Math.abs(o - projected) < Math.abs(best - projected) ? o : best), offsets[0] ?? 0);
    goTo(nearest);
  };

  const startDrag = (e: ReactPointerEvent) => controls.start(e);

  return (
    <>
      <motion.div
        className="lg-sheet__backdrop"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.22 }}
        onClick={onClose}
      />
      <motion.div
        className="lg-sheet__wrap"
        style={{ y, height }}
        {...(reduce ? { initial: { opacity: 0 }, animate: { opacity: 1 }, exit: { opacity: 0 } } : { exit: { y: height, transition: spring("gentle") } })}
        drag="y"
        dragControls={controls}
        dragListener={false}
        dragConstraints={{ top: offsets[offsets.length - 1] ?? 0, bottom: height }}
        dragElastic={{ top: 0.08, bottom: 0.2 }}
        dragMomentum={false}
        onDragEnd={onDragEnd}
      >
        <GlassSurface
          ref={panel as never}
          tint="strong"
          elevation={3}
          refract
          priority="core"
          radius="xl"
          className="lg-sheet"
          role="dialog"
          aria-modal={true}
          tabIndex={-1}
          style={{ borderRadius: "var(--r-xl) var(--r-xl) 0 0", height: "100%" }}
        >
          <div className="lg-sheet__grab" onPointerDown={startDrag}>
            <span className="lg-sheet__handle" aria-hidden />
            {title ? <div className="lg-sheet__title">{title}</div> : null}
          </div>
          <div className="lg-sheet__body">{children}</div>
        </GlassSurface>
      </motion.div>
    </>
  );
}

export interface ToastProps {
  id: string;
  level: ToastLevel;
  title: ReactNode;
  body?: ReactNode;
  icon?: ReactNode;
  /** ms; 0 = do odwołania */
  duration?: number;
  action?: { label: string; onPress(): void };
  onDismiss?(id: string): void;
}

const LEVEL_ICON: Record<ToastLevel, string> = { info: "info", warning: "warning", critical: "critical" };

/**
 * Toast w stylu iOS: pigułka szkła; dotknięcie rozwija treść i akcję, przeciągnięcie w górę zamyka.
 * Timer auto-zamknięcia zatrzymuje się, gdy toast jest rozwinięty lub przeciągany.
 */
export function Toast({ id, level, title, body, icon, duration = 5000, action, onDismiss }: ToastProps) {
  const [expanded, setExpanded] = useState(false);
  const [held, setHeld] = useState(false);
  const expandable = Boolean(body || action);
  const paused = expanded || held;

  useEffect(() => {
    if (!duration || paused) return;
    const t = setTimeout(() => onDismiss?.(id), duration);
    return () => clearTimeout(t);
  }, [id, duration, onDismiss, paused]);

  const onDragEnd = (_: unknown, info: PanInfo) => {
    setHeld(false);
    if (info.offset.y < -36 || info.velocity.y < -450) onDismiss?.(id);
  };

  return (
    <GlassSurface
      radius={expanded ? "lg" : "pill"}
      elevation={3}
      priority="normal"
      className="lg-toast"
      data-level={level}
      data-expanded={expanded || undefined}
      role={level === "critical" ? "alert" : "status"}
    >
      <motion.div
        className="lg-toast__inner"
        drag="y"
        dragConstraints={{ top: 0, bottom: 0 }}
        dragElastic={{ top: 0.7, bottom: 0.05 }}
        onDragStart={() => setHeld(true)}
        onDragEnd={onDragEnd}
        onTap={() => (expandable ? setExpanded((e) => !e) : onDismiss?.(id))}
        style={{ touchAction: "none" }}
      >
        <span className="lg-toast__icon">{icon ?? <Icon name={LEVEL_ICON[level]} size={28} />}</span>
        <div className="lg-toast__text">
          <div className="lg-toast__title">{title}</div>
          {body ? <div className="lg-toast__body">{body}</div> : null}
        </div>
      </motion.div>
      {expanded && action ? (
        <button
          type="button"
          className="lg-toast__action"
          onClick={() => {
            action.onPress();
            onDismiss?.(id);
          }}
        >
          {action.label}
        </button>
      ) : null}
    </GlassSurface>
  );
}

export interface ToastHostProps {
  toasts: readonly ToastProps[];
  /** maks. liczba widocznych toastów (stos), domyślnie 3 */
  max?: number;
}

/** Stos toastów u góry ekranu (najnowszy na górze); wejście sprężyną z góry, wyjście w górę. */
export function ToastHost({ toasts, max = 3 }: ToastHostProps) {
  const reduce = useReducedMotion();
  if (typeof document === "undefined") return null;
  const visible = toasts.slice(-max).reverse();
  return createPortal(
    <div className="lg-toast-host" aria-live="polite">
      <AnimatePresence mode="popLayout" initial={false}>
        {visible.map((t) => (
          <motion.div
            key={t.id}
            layout={!reduce}
            className="lg-toast-slot"
            initial={reduce ? { opacity: 0 } : { opacity: 0, y: -28, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={reduce ? { opacity: 0 } : { opacity: 0, y: -28, scale: 0.96 }}
            transition={reduce ? { duration: 0.12 } : spring("smooth")}
          >
            <Toast {...t} />
          </motion.div>
        ))}
      </AnimatePresence>
    </div>,
    document.body,
  );
}

export interface StatusBarProps {
  left?: ReactNode;
  center?: ReactNode;
  right?: ReactNode;
}

export function StatusBar({ left, center, right }: StatusBarProps) {
  return (
    <header className="lg-statusbar">
      <div>{left}</div>
      <div>{center}</div>
      <div>{right}</div>
    </header>
  );
}
