import type { FrameReport } from "./stats.ts";

export interface BenchRun {
  screen: string;
  tier: string;
  /** żądany tier / faktyczny `data-tier` po stronie strony */
  appliedTier: string | null;
  hz: 30 | 60;
  skipped?: string;
  frames?: FrameReport;
  cdp?: { scriptMs: number; taskMs: number; layoutMs: number; styleRecalcMs: number; heapMB: number } | null;
  trace?: string;
}

export interface BenchReport {
  generatedAt: string;
  browser: string;
  viewport: [number, number];
  seconds: number;
  runs: BenchRun[];
}

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

export function renderHtml(r: BenchReport): string {
  const rows = r.runs
    .map((x) => {
      if (!x.frames)
        return `<tr class="skip"><td>${esc(x.screen)}</td><td>${esc(x.tier)}</td><td>${x.hz}</td><td colspan="8">pominięto: ${esc(x.skipped ?? "")}</td></tr>`;
      const f = x.frames;
      const bad = f.droppedPct > 5 ? "bad" : f.droppedPct > 1 ? "warn" : "ok";
      return `<tr class="${bad}"><td>${esc(x.screen)}</td><td>${esc(x.tier)}${x.appliedTier && x.appliedTier !== x.tier ? ` <small>(zastosowano ${esc(x.appliedTier)})</small>` : ""}</td><td>${x.hz}</td><td>${f.fps}</td><td>${f.frameMs.p50}</td><td>${f.frameMs.p95}</td><td>${f.frameMs.p99}</td><td>${f.frameMs.max}</td><td>${f.dropped} (${f.droppedPct}%)</td><td>${f.jank}</td><td>${x.cdp ? `${x.cdp.scriptMs}/${x.cdp.layoutMs}/${x.cdp.styleRecalcMs} ms · ${x.cdp.heapMB} MB` : "–"}</td></tr>`;
    })
    .join("\n");
  return `<!doctype html><html lang="pl"><meta charset="utf-8"><title>yoga-auto — benchmark fps</title>
<style>:root{color-scheme:light dark}body{font:14px system-ui;margin:24px}table{border-collapse:collapse;width:100%}td,th{border:1px solid #8884;padding:4px 8px;text-align:right}td:first-child,td:nth-child(2),th:first-child,th:nth-child(2){text-align:left}tr.ok td:nth-child(4){color:#2a9d4a}tr.warn{background:#f0b4001a}tr.bad{background:#e5484d22}tr.skip{opacity:.55}small{opacity:.7}</style>
<h1>Benchmark fps</h1>
<p>${esc(r.generatedAt)} · ${esc(r.browser)} · viewport ${r.viewport.join("×")} · ${r.seconds} s na przebieg. Klatka zgubiona = odstęp rAF &gt; 25 ms (1.5 × 16.7 ms), jank = &gt; 50 ms. CDP: czas skryptu / layoutu / style recalc w oknie pomiaru, sterta JS.</p>
<table><thead><tr><th>Ekran</th><th>Tier</th><th>Hz</th><th>fps</th><th>p50 ms</th><th>p95 ms</th><th>p99 ms</th><th>max ms</th><th>zgubione</th><th>jank</th><th>CDP</th></tr></thead>
<tbody>${rows}</tbody></table></html>`;
}
