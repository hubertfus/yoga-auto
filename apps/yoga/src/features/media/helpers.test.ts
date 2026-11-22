import { describe, expect, it } from "vitest";
import type { MediaState } from "@yoga-auto/protocol";
import { artSrc, formatTime, interpolate, mediaView, progressFraction, sourceLabel } from "./helpers.ts";

const m = (o: Partial<MediaState> = {}): MediaState => ({
  source: "Spotify.exe",
  status: "playing",
  title: "T",
  artist: "A",
  album: null,
  artUrl: null,
  position: 10,
  duration: 100,
  positionAt: 0,
  canPlay: true,
  canPause: true,
  canNext: true,
  canPrev: true,
  canSeek: true,
  ...o,
});

describe("mediaView", () => {
  it("off bez capability, idle bez stanu lub tytułu, track gdy jest tytuł", () => {
    expect(mediaView(false, m())).toBe("off");
    expect(mediaView(true, null)).toBe("idle");
    expect(mediaView(true, m({ title: null, artist: null }))).toBe("idle");
    expect(mediaView(true, m({ title: null }))).toBe("track");
    expect(mediaView(true, m())).toBe("track");
  });
});

describe("interpolate", () => {
  it("dolicza czas od odebrania tylko podczas grania", () => {
    expect(interpolate(m(), 2500)).toBeCloseTo(12.5);
    expect(interpolate(m({ status: "paused" }), 5000)).toBe(10);
  });
  it("przycina do duration i nie schodzi poniżej 0; brak pozycji → null", () => {
    expect(interpolate(m({ position: 99 }), 5000)).toBe(100);
    expect(interpolate(m({ position: null }), 1000)).toBeNull();
    expect(interpolate(m(), -500)).toBe(10);
  });
});

describe("formatTime / sourceLabel / artSrc / progressFraction", () => {
  it("formatuje m:ss i h:mm:ss", () => {
    expect(formatTime(0)).toBe("0:00");
    expect(formatTime(65.9)).toBe("1:05");
    expect(formatTime(3725)).toBe("1:02:05");
    expect(formatTime(null)).toBe("–:––");
  });
  it("sourceLabel", () => {
    expect(sourceLabel("Spotify.exe")).toBe("Spotify");
    expect(sourceLabel("Chrome")).toBe("Chrome");
    expect(sourceLabel("SpotifyAB.SpotifyMusic_zpdnekdrzrea0!Spotify")).toBe("Spotify");
    expect(sourceLabel(null)).toBeNull();
  });
  it("artSrc dokleja token", () => {
    expect(artSrc(null, "t")).toBeNull();
    expect(artSrc("/media/art/ab.jpg", null)).toBe("/media/art/ab.jpg");
    expect(artSrc("/media/art/ab.jpg", "a b")).toBe("/media/art/ab.jpg?k=a%20b");
  });
  it("progressFraction", () => {
    expect(progressFraction(25, 100)).toBe(0.25);
    expect(progressFraction(5, null)).toBe(0);
    expect(progressFraction(500, 100)).toBe(1);
  });
});
