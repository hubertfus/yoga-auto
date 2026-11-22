/**
 * Latencja bridge → UI (przez WS) i offset zegara na podstawie ping/pong.
 *
 *  - RTT: `ping{t0}` → `pong{t0, ts}`; offset = ts − (t0 + RTT/2) (NTP-owo, mediana z próbek),
 *  - opóźnienie jednokierunkowe bridge → klient: odbiór − offset − `fast.ts`,
 *  - jitter: odstępy między kolejnymi `fast`.
 * Ograniczenie: `fast.ts` to czas bridge'a przy wysłaniu, więc odcinek gra → bridge (pipe) wymaga znacznika
 * czasu z pluginu — do zrobienia w sesji integracyjnej (zob. docs/progress/s7.md).
 */
import { WebSocket } from "ws";
import { WS_SUBPROTOCOL, type ServerMsg } from "@yoga-auto/protocol";
import { summarize, type Summary } from "./stats.ts";

export interface LatencyReport {
  seconds: number;
  fastHz: number;
  rttMs: Summary;
  clockOffsetMs: number;
  oneWayMs: Summary;
  fastIntervalMs: Summary;
  fastMessages: number;
}

export async function measureLatency(port: number, seconds: number, fastHz: 15 | 30 | 60): Promise<LatencyReport> {
  const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`, [WS_SUBPROTOCOL]);
  const rtts: number[] = [];
  const offsets: number[] = [];
  const fast: { ts: number; at: number }[] = [];
  ws.on("message", (d) => {
    const at = Date.now();
    const m = JSON.parse(String(d)) as ServerMsg;
    if (m.t === "pong") {
      const rtt = at - m.t0;
      rtts.push(rtt);
      offsets.push(m.ts - (m.t0 + rtt / 2));
    } else if (m.t === "fast") fast.push({ ts: m.ts, at });
  });
  await new Promise<void>((res, rej) => {
    ws.once("open", () => res());
    ws.once("error", rej);
  });
  ws.send(JSON.stringify({ t: "subscribe", fastHz, placement: false }));
  const timer = setInterval(() => ws.send(JSON.stringify({ t: "ping", t0: Date.now() })), 100);
  await new Promise((r) => setTimeout(r, seconds * 1000));
  clearInterval(timer);
  ws.close();
  const sortedOff = [...offsets].sort((a, b) => a - b);
  const offset = sortedOff.length ? sortedOff[Math.floor(sortedOff.length / 2)]! : 0;
  const oneWay = fast.map((f) => f.at - offset - f.ts);
  const intervals = fast.slice(1).map((f, i) => f.at - fast[i]!.at);
  return {
    seconds,
    fastHz,
    rttMs: summarize(rtts),
    clockOffsetMs: Math.round(offset * 100) / 100,
    oneWayMs: summarize(oneWay),
    fastIntervalMs: summarize(intervals),
    fastMessages: fast.length,
  };
}
