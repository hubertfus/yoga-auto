import { useEffect, type ReactNode } from "react";
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

export function Dock({ items, active, onSelect, position = "left" }: DockProps) {
  return (
    <nav className="lg-surface lg-dock" data-refract data-position={position}>
      {items.map((i) => (
        <button
          key={i.id}
          type="button"
          className="lg-dock__item"
          data-active={i.id === active || undefined}
          aria-label={i.label}
          onClick={() => onSelect(i.id)}
        >
          {i.icon}
          {i.badge != null ? <span className="lg-dock__badge">{i.badge}</span> : null}
        </button>
      ))}
    </nav>
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

export function Sheet({ open, onClose, title, children }: SheetProps) {
  if (!open) return null;
  return (
    <div className="lg-sheet__backdrop" onClick={onClose}>
      <div className="lg-surface lg-sheet" data-tint="strong" data-refract onClick={(e) => e.stopPropagation()}>
        {title ? <div className="lg-panel__title">{title}</div> : null}
        {children}
      </div>
    </div>
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

export function Toast({ id, level, title, body, icon, duration = 5000, action, onDismiss }: ToastProps) {
  useEffect(() => {
    if (!duration) return;
    const t = setTimeout(() => onDismiss?.(id), duration);
    return () => clearTimeout(t);
  }, [id, duration, onDismiss]);
  return (
    <div className="lg-surface lg-toast" data-level={level} role="status" onClick={() => onDismiss?.(id)}>
      {icon}
      <div>
        <div className="lg-toast__title">{title}</div>
        {body ? <div className="lg-toast__body">{body}</div> : null}
      </div>
      {action ? (
        <button type="button" onClick={action.onPress}>
          {action.label}
        </button>
      ) : null}
    </div>
  );
}

export interface ToastHostProps {
  toasts: readonly ToastProps[];
  max?: number;
}

export function ToastHost({ toasts, max = 3 }: ToastHostProps) {
  return (
    <div className="lg-toast-host">
      {toasts.slice(-max).map((t) => (
        <Toast key={t.id} {...t} />
      ))}
    </div>
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
