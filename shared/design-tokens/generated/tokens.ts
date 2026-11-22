// AUTO-GENERATED from tokens.json — DO NOT EDIT
export const tokens = {
  "color": {
    "dark": {
      "bg-0": "oklch(14% 0.01 260)",
      "glass-tint": "oklch(30% 0.02 260)",
      "glass-tint-strong": "oklch(22% 0.02 260)",
      "text-1": "oklch(98% 0 0)",
      "text-2": "oklch(80% 0.01 260)",
      "text-3": "oklch(62% 0.01 260)",
      "accent": "oklch(72% 0.17 245)",
      "on": "oklch(80% 0.19 150)",
      "lights": "oklch(88% 0.16 95)",
      "beam-high": "oklch(75% 0.15 250)",
      "warn": "oklch(80% 0.17 75)",
      "crit": "oklch(65% 0.23 25)",
      "rim-top": "rgb(255 255 255 / 0.45)",
      "rim-bottom": "rgb(255 255 255 / 0.08)"
    },
    "light": {
      "bg-0": "oklch(94% 0.01 260)",
      "glass-tint": "oklch(98% 0.005 260)",
      "glass-tint-strong": "oklch(96% 0.01 260)",
      "text-1": "oklch(20% 0.01 260)",
      "text-2": "oklch(38% 0.01 260)",
      "text-3": "oklch(55% 0.01 260)",
      "accent": "oklch(58% 0.19 250)",
      "on": "oklch(62% 0.18 150)",
      "lights": "oklch(70% 0.16 80)",
      "beam-high": "oklch(55% 0.17 255)",
      "warn": "oklch(68% 0.17 65)",
      "crit": "oklch(56% 0.22 25)",
      "rim-top": "rgb(255 255 255 / 0.85)",
      "rim-bottom": "rgb(0 0 0 / 0.08)"
    },
    "night": {
      "accent": "oklch(74% 0.14 60)",
      "dim": "0.75"
    }
  },
  "material": {
    "dark": {
      "glass-alpha": "66%",
      "glass-alpha-strong": "82%",
      "glass-alpha-clear": "34%",
      "glass-bright": "0.78",
      "glass-flat": "oklch(25% 0.02 260)",
      "glass-flat-strong": "oklch(20% 0.02 260)",
      "specular": "rgb(255 255 255 / 0.20)",
      "text-halo": "0 1px 2px rgb(0 0 0 / 0.5)",
      "scrim": "rgb(0 0 0 / 0.45)"
    },
    "light": {
      "glass-alpha": "58%",
      "glass-alpha-strong": "80%",
      "glass-alpha-clear": "32%",
      "glass-bright": "1.04",
      "glass-flat": "oklch(96% 0.005 260)",
      "glass-flat-strong": "oklch(94% 0.01 260)",
      "specular": "rgb(255 255 255 / 0.65)",
      "text-halo": "0 1px 1px rgb(255 255 255 / 0.45)",
      "scrim": "rgb(0 0 0 / 0.25)"
    },
    "night": {
      "glass-bright": "0.66",
      "specular": "rgb(255 230 200 / 0.12)"
    }
  },
  "radius": {
    "xs": "10px",
    "sm": "16px",
    "md": "22px",
    "lg": "28px",
    "xl": "36px",
    "pill": "999px"
  },
  "space": {
    "1": "4px",
    "2": "8px",
    "3": "12px",
    "4": "16px",
    "5": "24px",
    "6": "32px",
    "7": "48px",
    "8": "64px"
  },
  "hit": {
    "sm": "48px",
    "md": "56px",
    "lg": "72px",
    "xl": "88px"
  },
  "shadow": {
    "1": "0 4px 16px rgb(0 0 0 / 0.25)",
    "2": "0 8px 32px rgb(0 0 0 / 0.35)",
    "3": "0 16px 48px rgb(0 0 0 / 0.45)"
  },
  "font": {
    "family": "\"Inter Variable\", Inter, \"Segoe UI Variable\", \"Segoe UI\", system-ui, sans-serif",
    "display": "700 96px/1",
    "h1": "650 48px/1.1",
    "h2": "600 32px/1.15",
    "body": "500 20px/1.3",
    "label": "600 16px/1.2",
    "caption": "500 14px/1.2"
  },
  "duration": {
    "fast": "120ms",
    "base": "220ms",
    "slow": "380ms"
  },
  "z": {
    "wallpaper": "0",
    "content": "10",
    "dock": "20",
    "sheet": "30",
    "toast": "40",
    "overlay": "50"
  },
  "tier": {
    "ultra": {
      "glass-blur": "24px",
      "glass-sat": "180%",
      "refract-scale": "38",
      "max-surfaces": "8"
    },
    "high": {
      "glass-blur": "20px",
      "glass-sat": "180%",
      "refract-scale": "28",
      "max-surfaces": "6"
    },
    "lite": {
      "glass-blur": "10px",
      "glass-sat": "160%",
      "refract-scale": "0",
      "max-surfaces": "4"
    },
    "flat": {
      "glass-blur": "0px",
      "glass-sat": "100%",
      "refract-scale": "0",
      "max-surfaces": "0"
    }
  },
  "spring": {
    "snappy": {
      "stiffness": 520,
      "damping": 34,
      "mass": 1
    },
    "smooth": {
      "stiffness": 300,
      "damping": 30,
      "mass": 1
    },
    "gentle": {
      "stiffness": 170,
      "damping": 26,
      "mass": 1
    },
    "gauge": {
      "stiffness": 120,
      "damping": 20,
      "mass": 0.8
    }
  }
} as const;
export type PerfTier = keyof typeof tokens.tier;
export const PERF_TIERS = ["ultra", "high", "lite", "flat"] as const satisfies readonly PerfTier[];
export type SpringName = keyof typeof tokens.spring;
export const springs = tokens.spring;
