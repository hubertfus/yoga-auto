import type { Story } from "./ladleTypes.ts";
import { Stage, WALLPAPER_NAMES, type Wallpaper } from "./Stage.tsx";
import {
  ButtonsDemo,
  CardsDemo,
  ControlsDemo,
  DockDemo,
  GaugesDemo,
  IconsDemo,
  SheetDemo,
  StatusBarDemo,
  ToastDemo,
} from "./Showcase.tsx";
import { GlassPanel, GlassSurface } from "../index.ts";
import type { PerfTier } from "../types.ts";

type Args = { tier: PerfTier; wallpaper: Wallpaper; night: boolean };
const argTypes = {
  tier: { options: ["ultra", "high", "lite", "flat"], control: { type: "select" as const }, defaultValue: "high" },
  wallpaper: { options: [...WALLPAPER_NAMES], control: { type: "select" as const }, defaultValue: "aurora" },
  night: { control: { type: "boolean" as const }, defaultValue: false },
};

const make = (title: string, body: () => React.ReactNode): Story<Args> => {
  const S: Story<Args> = ({ tier, wallpaper, night }) => (
    <Stage tier={tier} wallpaper={wallpaper} night={night}>
      <div style={{ paddingLeft: title === "Dock" ? 120 : 0 }}>{body()}</div>
    </Stage>
  );
  S.storyName = title;
  S.argTypes = argTypes;
  return S;
};

export default { title: "Komponenty" };

export const Surface = make("GlassSurface / Panel", () => (
  <div style={{ display: "flex", gap: 24, flexWrap: "wrap" }}>
    {([1, 2, 3] as const).map((e) => (
      <GlassSurface key={e} elevation={e} refract radius="xl" style={{ width: 240, height: 160, padding: 20 }}>
        elevation {e} · refract
      </GlassSurface>
    ))}
    <GlassPanel title="Panel" padding={20} tint="strong" style={{ width: 240 }}>tint strong</GlassPanel>
    <GlassPanel title="Panel" padding={20} tint="clear" style={{ width: 240 }}>tint clear</GlassPanel>
  </div>
));
export const Buttons = make("GlassButton", () => <ButtonsDemo />);
export const Controls = make("Toggle / Segmented / Slider", () => <ControlsDemo />);
export const Cards = make("GlassCard", () => <CardsDemo />);
export const Gauges = make("Gauge + Numeric", () => <GaugesDemo />);
export const DockLeft = make("Dock", () => <DockDemo />);
export const DockBottom = make("Dock (bottom)", () => <DockDemo position="bottom" />);
export const SheetStory = make("Sheet", () => <SheetDemo />);
export const Toasts = make("Toast / ToastHost", () => <ToastDemo />);
export const StatusBarStory = make("StatusBar", () => <StatusBarDemo />);
export const Icons = make("Icon (ikony pojazdu)", () => <IconsDemo />);
