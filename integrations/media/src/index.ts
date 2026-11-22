/** Dostawcy mediów. F0: NullMediaProvider, MockMediaProvider. S6: SmtcMediaProvider. */
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
  { title: "Autobahn Nights", artist: "Mock Artist", album: "Highway Demo", duration: 214 },
  { title: "Diesel & Rain", artist: "Mock Artist", album: "Highway Demo", duration: 187 },
  { title: "Long Haul", artist: "The Placeholders", album: "Test Tracks", duration: 243 },
];

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
      artUrl: null,
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
