import { useRef, type ReactNode } from "react";
import type { ButtonSize, Tone } from "./types.ts";

export interface GlassButtonProps {
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
  "aria-label"?: string;
}

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
  "aria-label": ariaLabel,
}: GlassButtonProps) {
  const holding = useRef(false);
  const end = () => {
    if (holding.current) {
      holding.current = false;
      onHoldEnd?.();
    }
  };
  return (
    <button
      type="button"
      className="lg-surface lg-button"
      data-size={size}
      data-variant={variant}
      data-tone={tone}
      data-active={active || undefined}
      data-pending={pending || undefined}
      disabled={disabled}
      aria-label={ariaLabel}
      aria-pressed={active}
      onPointerDown={(e) => {
        if (!onHoldStart) return;
        e.currentTarget.setPointerCapture?.(e.pointerId);
        holding.current = true;
        onHoldStart();
      }}
      onPointerUp={end}
      onPointerCancel={end}
      onClick={() => {
        if (!onHoldStart) onPress?.();
      }}
    >
      {icon ? <span className="lg-button__icon">{icon}</span> : null}
      {label ? <span className="lg-button__label">{label}</span> : null}
    </button>
  );
}

export interface GlassToggleProps {
  checked: boolean;
  onChange(value: boolean): void;
  label?: ReactNode;
  disabled?: boolean;
}

export function GlassToggle({ checked, onChange, label, disabled }: GlassToggleProps) {
  return (
    <label className="lg-toggle" data-checked={checked || undefined}>
      <input type="checkbox" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
      <span className="lg-toggle__track">
        <span className="lg-toggle__thumb" />
      </span>
      {label ? <span>{label}</span> : null}
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
}

export function GlassSegmented<T extends string>({ options, value, onChange, pending }: GlassSegmentedProps<T>) {
  return (
    <div className="lg-surface lg-segmented" data-pending={pending || undefined} role="radiogroup">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={o.value === value}
          data-active={o.value === value || undefined}
          onClick={() => onChange(o.value)}
        >
          {o.icon}
          {o.label}
        </button>
      ))}
    </div>
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
}

export function GlassSlider({ min, max, step = 1, value, onChange, vertical, label }: GlassSliderProps) {
  return (
    <label className="lg-slider" data-vertical={vertical || undefined}>
      {label}
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
      />
    </label>
  );
}
