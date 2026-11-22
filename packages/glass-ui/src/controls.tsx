import {
  useCallback,
  useEffect,
  useId,
  useRef,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";
import { GlassSurface } from "./surface.tsx";
import type { ButtonSize, Tone } from "./types.ts";

type DataAttrs = { [key: `data-${string}`]: string | number | boolean | undefined };

export interface GlassButtonProps extends DataAttrs {
  size?: ButtonSize;
  icon?: ReactNode;
  label?: ReactNode;
  variant?: "plain" | "tinted" | "filled";
  /** świeci — stan z telemetrii */
  active?: boolean;
  /** czeka na ack */
  pending?: boolean;
  disabled?: boolean;
  tone?: Tone;
  onPress?: () => void;
  /** Jeśli podane, przycisk działa w trybie hold (pointer capture). */
  onHoldStart?: () => void;
  onHoldEnd?: () => void;
  /** prawdziwe szkło z backdrop-filter (liczy się do limitu powierzchni); domyślnie tanie półprzezroczyste wypełnienie */
  glass?: boolean;
  className?: string;
  style?: CSSProperties;
  title?: string;
  "aria-label"?: string;
}

/**
 * Przycisk akcji. Feedback naciśnięcia < 50 ms: `data-pressed` ustawiane synchronicznie na pointerdown
 * (poza cyklem Reacta) + CSS `:active`. Tryb hold: pointer capture, `onHoldEnd` wywoływane DOKŁADNIE raz
 * także przy anulowaniu, utracie capture, blur, ukryciu karty i odmontowaniu.
 */
export function GlassButton({
  size = "md",
  icon,
  label,
  variant = "tinted",
  active,
  pending,
  disabled,
  tone = "accent",
  onPress,
  onHoldStart,
  onHoldEnd,
  glass = false,
  className,
  style,
  title,
  "aria-label": ariaLabel,
  ...data
}: GlassButtonProps) {
  const el = useRef<HTMLButtonElement | null>(null);
  const holding = useRef(false);
  const holdEndRef = useRef(onHoldEnd);
  holdEndRef.current = onHoldEnd;
  const isHold = Boolean(onHoldStart);

  const end = useCallback(() => {
    el.current?.removeAttribute("data-pressed");
    if (holding.current) {
      holding.current = false;
      holdEndRef.current?.();
    }
  }, []);
  const begin = useCallback(
    (hold: () => void) => {
      if (holding.current) return;
      holding.current = true;
      el.current?.setAttribute("data-pressed", "");
      hold();
    },
    [],
  );

  // bezpieczeństwo: zwolnij hold przy odmontowaniu i ukryciu karty
  useEffect(() => {
    const onHide = () => {
      if (document.hidden) end();
    };
    document.addEventListener("visibilitychange", onHide);
    return () => {
      document.removeEventListener("visibilitychange", onHide);
      end();
    };
  }, [end]);
  useEffect(() => {
    if (disabled) end();
  }, [disabled, end]);

  const down = (e: ReactPointerEvent<HTMLButtonElement>) => {
    if (disabled) return;
    if (e.pointerType === "mouse" && e.button !== 0) return;
    el.current?.setAttribute("data-pressed", "");
    if (!onHoldStart) return;
    try {
      e.currentTarget.setPointerCapture?.(e.pointerId);
    } catch {
      /* pointer już nieaktywny */
    }
    begin(onHoldStart);
  };
  const up = () => {
    if (isHold) end();
    else el.current?.removeAttribute("data-pressed");
  };
  const keyDown = (e: ReactKeyboardEvent<HTMLButtonElement>) => {
    if (!onHoldStart || disabled || e.repeat) return;
    if (e.key === " " || e.key === "Enter") {
      e.preventDefault();
      begin(onHoldStart);
    }
  };
  const keyUp = (e: ReactKeyboardEvent<HTMLButtonElement>) => {
    if (onHoldStart && (e.key === " " || e.key === "Enter")) {
      e.preventDefault();
      end();
    }
  };

  return (
    <GlassSurface
      {...data}
      as="button"
      ref={el}
      type="button"
      radius={size === "xl" ? "lg" : size === "sm" ? "sm" : "md"}
      backdrop={glass}
      priority="low"
      className={`lg-button ${className ?? ""}`}
      style={style}
      data-size={size}
      data-variant={variant}
      data-tone={tone}
      data-active={active || undefined}
      data-pending={pending || undefined}
      data-hold={isHold || undefined}
      disabled={disabled}
      title={title}
      aria-label={ariaLabel}
      aria-pressed={active}
      aria-busy={pending || undefined}
      onPointerDown={down}
      onPointerUp={up}
      onPointerCancel={up}
      onLostPointerCapture={isHold ? end : undefined}
      onBlur={isHold ? end : undefined}
      onKeyDown={keyDown}
      onKeyUp={keyUp}
      onContextMenu={(e: { preventDefault(): void }) => e.preventDefault()}
      onClick={() => {
        if (!isHold && !disabled) onPress?.();
      }}
    >
      {icon ? <span className="lg-button__icon">{icon}</span> : null}
      {label ? <span className="lg-button__label">{label}</span> : null}
    </GlassSurface>
  );
}

export interface GlassToggleProps {
  checked: boolean;
  onChange(value: boolean): void;
  label?: ReactNode;
  disabled?: boolean;
}

/** Przełącznik 56 px (iOS-owy), `role="switch"`; gałka z sprężystym przejściem CSS (`--ease-snappy`). */
export function GlassToggle({ checked, onChange, label, disabled }: GlassToggleProps) {
  return (
    <label className="lg-toggle" data-checked={checked || undefined} data-disabled={disabled || undefined}>
      {label ? <span className="lg-toggle__label">{label}</span> : null}
      <input
        type="checkbox"
        role="switch"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
      />
      <span className="lg-toggle__track" aria-hidden>
        <span className="lg-toggle__thumb" />
      </span>
    </label>
  );
}

export interface SegmentOption<T extends string> {
  value: T;
  label: ReactNode;
  icon?: ReactNode;
}

export interface GlassSegmentedProps<T extends string> {
  options: readonly SegmentOption<T>[];
  value: T | null;
  onChange(value: T): void;
  pending?: boolean;
  className?: string;
}

/** Segmenty o równej szerokości; wskaźnik przesuwa się sprężyną CSS (transform). `value=null` = brak wyboru. */
export function GlassSegmented<T extends string>({ options, value, onChange, pending, className }: GlassSegmentedProps<T>) {
  const index = options.findIndex((o) => o.value === value);
  const move = (dir: 1 | -1) => {
    const base = index < 0 ? (dir === 1 ? -1 : options.length) : index;
    const next = options[(base + dir + options.length) % options.length];
    if (next) onChange(next.value);
  };
  return (
    <GlassSurface
      radius="md"
      backdrop={false}
      className={`lg-segmented ${className ?? ""}`}
      data-pending={pending || undefined}
      role="radiogroup"
      aria-busy={pending || undefined}
      style={{ "--n": options.length, "--i": Math.max(index, 0) } as CSSProperties}
    >
      {index >= 0 ? <span className="lg-segmented__thumb" aria-hidden /> : null}
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={o.value === value}
          tabIndex={o.value === value || (index < 0 && o === options[0]) ? 0 : -1}
          data-active={o.value === value || undefined}
          onClick={() => onChange(o.value)}
          onKeyDown={(e) => {
            if (e.key === "ArrowRight" || e.key === "ArrowDown") {
              e.preventDefault();
              move(1);
            } else if (e.key === "ArrowLeft" || e.key === "ArrowUp") {
              e.preventDefault();
              move(-1);
            }
          }}
        >
          {o.icon}
          {o.label}
        </button>
      ))}
    </GlassSurface>
  );
}

export interface GlassSliderProps {
  min: number;
  max: number;
  step?: number;
  value: number;
  onChange(value: number): void;
  vertical?: boolean;
  label?: ReactNode;
  /** wywoływane po puszczeniu / zatwierdzeniu klawiaturą */
  onCommit?(value: number): void;
  /** tekst wartości (np. stopień retardera) */
  format?(value: number): string;
  disabled?: boolean;
  /** długość w px (domyślnie 100% szerokości / 240 px dla vertical) */
  length?: number;
}

export const snapValue = (raw: number, min: number, max: number, step: number): number => {
  const clamped = Math.max(min, Math.min(max, raw));
  const snapped = min + Math.round((clamped - min) / step) * step;
  const decimals = (String(step).split(".")[1] ?? "").length;
  return Math.max(min, Math.min(max, Number(snapped.toFixed(decimals))));
};

/**
 * Suwak: gałka ≥ 44 px (obszar dotyku = cały pasek), pointer capture, `touch-action: none`,
 * klawiatura (strzałki, PageUp/PageDown, Home/End). Wartość snapuje do `step` (stopnie retardera).
 */
export function GlassSlider({
  min,
  max,
  step = 1,
  value,
  onChange,
  vertical,
  label,
  onCommit,
  format,
  disabled,
  length,
}: GlassSliderProps) {
  const track = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);
  const last = useRef(value);
  last.current = value;
  const labelId = useId();
  const fraction = max === min ? 0 : (value - min) / (max - min);

  const fromPointer = (e: ReactPointerEvent) => {
    const r = track.current?.getBoundingClientRect();
    if (!r) return;
    const f = vertical ? 1 - (e.clientY - r.top) / r.height : (e.clientX - r.left) / r.width;
    const next = snapValue(min + Math.max(0, Math.min(1, f)) * (max - min), min, max, step);
    if (next !== last.current) {
      last.current = next;
      onChange(next);
    }
  };
  const down = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (disabled) return;
    dragging.current = true;
    try {
      e.currentTarget.setPointerCapture?.(e.pointerId);
    } catch {
      /* ignore */
    }
    fromPointer(e);
  };
  const move = (e: ReactPointerEvent) => {
    if (dragging.current) fromPointer(e);
  };
  const up = () => {
    if (!dragging.current) return;
    dragging.current = false;
    onCommit?.(last.current);
  };
  const key = (e: ReactKeyboardEvent) => {
    if (disabled) return;
    let next: number | null = null;
    switch (e.key) {
      case "ArrowRight":
      case "ArrowUp":
        next = value + step;
        break;
      case "ArrowLeft":
      case "ArrowDown":
        next = value - step;
        break;
      case "PageUp":
        next = value + step * 10;
        break;
      case "PageDown":
        next = value - step * 10;
        break;
      case "Home":
        next = min;
        break;
      case "End":
        next = max;
        break;
    }
    if (next === null) return;
    e.preventDefault();
    const v = snapValue(next, min, max, step);
    if (v !== value) {
      onChange(v);
      onCommit?.(v);
    }
  };

  const size: CSSProperties = length ? (vertical ? { height: length } : { width: length }) : {};
  return (
    <div className="lg-slider" data-vertical={vertical || undefined} data-disabled={disabled || undefined} style={size}>
      {label ? (
        <span className="lg-slider__label" id={labelId}>
          {label}
          {format ? <b>{format(value)}</b> : null}
        </span>
      ) : null}
      <div
        ref={track}
        className="lg-slider__control"
        role="slider"
        tabIndex={disabled ? -1 : 0}
        aria-labelledby={label ? labelId : undefined}
        aria-valuemin={min}
        aria-valuemax={max}
        aria-valuenow={value}
        aria-valuetext={format?.(value)}
        aria-orientation={vertical ? "vertical" : "horizontal"}
        aria-disabled={disabled || undefined}
        style={{ "--p": fraction } as CSSProperties}
        onPointerDown={down}
        onPointerMove={move}
        onPointerUp={up}
        onPointerCancel={up}
        onKeyDown={key}
      >
        <div className="lg-slider__rail">
          <div className="lg-slider__fill" />
        </div>
        <div className="lg-slider__thumb" />
      </div>
    </div>
  );
}
