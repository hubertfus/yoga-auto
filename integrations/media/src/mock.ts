/** NullMediaProvider i MockMediaProvider (playlista testowa z okładkami SVG). */
import type { MediaAction, MediaProvider, MediaState } from "@yoga-auto/protocol";

export class NullMediaProvider implements MediaProvider {
  readonly name = "null";
  async start(): Promise<void> {}
  async stop(): Promise<void> {}
  getState(): MediaState | null {
    return null;
  }
  onChange(): () => void {
    return () => {};
  }
  async command(): Promise<void> {
    throw new Error("no media provider");
  }
}

const PLAYLIST = [
  { title: "Autobahn Nights", artist: "Mock Artist", album: "Highway Demo", duration: 214, hue: 265 },
  { title: "Diesel & Rain", artist: "Mock Artist", album: "Highway Demo", duration: 187, hue: 200 },
  { title: "Long Haul", artist: "The Placeholders", album: "Test Tracks", duration: 243, hue: 25 },
  { title: "Krótki utwór (test końca)", artist: "The Placeholders", album: "Test Tracks", duration: 12, hue: 140 },
];

const coverSvg = (hue: number, label: string): string =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 300 300"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">` +
  `<stop offset="0" stop-color="hsl(${hue} 80% 55%)"/><stop offset="1" stop-color="hsl(${(hue + 60) % 360} 70% 25%)"/></linearGradient></defs>` +
  `<rect width="300" height="300" fill="url(#g)"/><circle cx="150" cy="150" r="70" fill="none" stroke="#fff" stroke-opacity=".5" stroke-width="6"/>` +
  `<text x="150" y="160" text-anchor="middle" font-size="36" fill="#fff" font-family="sans-serif">${label}</text></svg>`;

/** Udaje odtwarzacz: playlista w pętli, reaguje na komendy. */
export class MockMediaProvider implements MediaProvider {
  readonly name = "mock";
  private idx = 0;
  private playing = true;
  private position = 0;
  private positionAt = Date.now();
  private timer: ReturnType<typeof setInterval> | null = null;
  private handlers = new Set<(s: MediaState | null) => void>();

  async start(): Promise<void> {
    this.timer = setInterval(() => {
      if (this.playing && this.currentPosition() >= this.track().duration) this.skip(1);
    }, 1000);
  }

  async stop(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
  }

  getState(): MediaState {
    const t = this.track();
    return {
      source: "Spotify.exe",
      status: this.playing ? "playing" : "paused",
      title: t.title,
      artist: t.artist,
      album: t.album,
      artUrl: `/media/art/mock${this.idx % PLAYLIST.length}.jpg`,
      position: this.currentPosition(),
      duration: t.duration,
      positionAt: Date.now(),
      canPlay: true,
      canPause: true,
      canNext: true,
      canPrev: true,
      canSeek: true,
    };
  }

  async getArt(hash: string): Promise<{ mime: string; data: Uint8Array } | null> {
    const m = /^mock(\d+)$/.exec(hash);
    const t = m ? PLAYLIST[Number(m[1])] : undefined;
    return t ? { mime: "image/svg+xml", data: new TextEncoder().encode(coverSvg(t.hue, `♪ ${m![1]}`)) } : null;
  }

  onChange(handler: (s: MediaState | null) => void): () => void {
    this.handlers.add(handler);
    return () => this.handlers.delete(handler);
  }

  async command(action: MediaAction, value?: number): Promise<void> {
    const pos = this.currentPosition();
    switch (action) {
      case "play":
        this.playing = true;
        break;
      case "pause":
        this.playing = false;
        break;
      case "toggle":
        this.playing = !this.playing;
        break;
      case "next":
        return this.skip(1);
      case "prev":
        return this.skip(-1);
      case "seek":
        this.position = Math.max(0, Math.min(this.track().duration, value ?? 0));
        this.positionAt = Date.now();
        this.emit();
        return;
    }
    this.position = pos;
    this.positionAt = Date.now();
    this.emit();
  }

  private track() {
    return PLAYLIST[this.idx % PLAYLIST.length]!;
  }

  private currentPosition(): number {
    return this.playing ? this.position + (Date.now() - this.positionAt) / 1000 : this.position;
  }

  private skip(d: number) {
    this.idx = (this.idx + d + PLAYLIST.length) % PLAYLIST.length;
    this.position = 0;
    this.positionAt = Date.now();
    this.emit();
  }

  private emit() {
    const s = this.getState();
    this.handlers.forEach((h) => h(s));
  }
}
