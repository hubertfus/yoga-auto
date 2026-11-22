import type { Story } from "./ladleTypes.ts";
import { Stage, WALLPAPER_NAMES, type Wallpaper } from "./Stage.tsx";
import { Everything } from "./Showcase.tsx";
import type { PerfTier } from "../types.ts";

/** Jedna story na tier (DESIGN.md §5) — pełny zestaw komponentów; tapeta do wyboru w panelu kontrolek. */
const tier = (t: PerfTier): Story<{ wallpaper: Wallpaper; night: boolean }> => {
  const S: Story<{ wallpaper: Wallpaper; night: boolean }> = ({ wallpaper, night }) => (
    <Stage tier={t} wallpaper={wallpaper} night={night}>
      <Everything />
    </Stage>
  );
  S.storyName = `tier: ${t}`;
  S.argTypes = {
    wallpaper: { options: [...WALLPAPER_NAMES], control: { type: "select" }, defaultValue: "aurora" },
    night: { control: { type: "boolean" }, defaultValue: false },
  };
  return S;
};

export default { title: "Tiery" };
export const Ultra = tier("ultra");
export const High = tier("high");
export const Lite = tier("lite");
export const Flat = tier("flat");

export const Auto: Story = () => (
  <Stage tier="auto">
    <Everything />
  </Stage>
);
Auto.storyName = "auto (FrameMonitor + degradacja; dodaj ?burn=1 do URL)";

export const Light: Story = () => (
  <Stage tier="high" theme="light" wallpaper="aurora">
    <Everything />
  </Stage>
);
Light.storyName = "motyw jasny";
