/**
 * Home w stylu CarPlay: strony siatki 4×2 z kafli (WidgetDef z registry), swipe poziomy między stronami,
 * kropki stron. Bez gestów od krawędzi ekranu (DESIGN §7).
 *
 * Edytor układu (M4): długie przytrzymanie kafla → tryb edycji (drżenie, ×, „+”, „Gotowe”);
 * przeciąganie kafla (pointer events, bez bibliotek) zmienia kolejność, także między stronami
 * (przytrzymanie przy krawędzi przewraca stronę). Układ zapisywany w localStorage (homeLayout.ts).
 */
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { animate, motion, useMotionValue, useReducedMotion } from "motion/react";
import { springs } from "@yoga-auto/design-tokens";
import { GlassButton, GlassCard, Icon, Sheet } from "@yoga-auto/glass-ui";
import { getWidgets } from "../core/registry.ts";
import { navigate } from "../core/router.ts";
import {
  GRID_COLS,
  GRID_ROWS,
  addId,
  addableWidgets,
  dropOnId,
  dropOnPageEnd,
  paginate,
  removeId,
  resolveWidgets,
  saveLayout,
} from "./homeLayout.ts";

const SWIPE_DISTANCE = 0.18; // część szerokości
const SWIPE_VELOCITY = 450; // px/s
const DRAG_START_PX = 8;
const EDGE_PX = 64; // strefa przewracania strony podczas przeciągania
const EDGE_DWELL_MS = 550;
const REORDER_COOLDOWN_MS = 160; // tłumi „flapping” przy kafelkach różnych rozmiarów

interface Gesture {
  id: string;
  pid: number;
  sx: number;
  sy: number;
  ox: number; // przesunięcie palca względem rogu kafla
  oy: number;
  w: number;
  h: number;
  mode: "armed" | "drag";
  lastReorder: number;
  edgeDir: -1 | 0 | 1;
  edgeTimer: number;
}

interface DragInfo {
  id: string;
  w: number;
  h: number;
  label: string;
}

export function Home() {
  const [ids, setIds] = useState<string[]>(() => resolveWidgets().map((w) => w.id));
  const widgets = useMemo(() => {
    const byId = new Map(getWidgets().map((w) => [w.id, w]));
    return ids.flatMap((id) => byId.get(id) ?? []);
  }, [ids]);
  const pages = useMemo(() => paginate(widgets), [widgets]);

  const [page, setPage] = useState(0);
  const [editing, setEditing] = useState(false);
  const [drag, setDrag] = useState<DragInfo | null>(null);
  const [addOpen, setAddOpen] = useState(false);

  const viewport = useRef<HTMLDivElement>(null);
  const ghost = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  const x = useMotionValue(0);
  const reduced = useReducedMotion();
  const dragged = useRef(false);

  const last = Math.max(0, pages.length - 1);
  const pageC = Math.min(page, last);

  // świeże wartości dla handlerów okna (rejestrowanych raz na gest)
  const live = useRef({ ids, pages, page: pageC, last });
  live.current = { ids, pages, page: pageC, last };
  const gesture = useRef<Gesture | null>(null);
  const lastDown = useRef<{ id: string; pid: number; x: number; y: number; rect: DOMRect } | null>(null);
  const pointer = useRef({ x: 0, y: 0 });

  useLayoutEffect(() => {
    const el = viewport.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setWidth(el.clientWidth));
    ro.observe(el);
    setWidth(el.clientWidth);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    const target = -pageC * width;
    const controls = reduced
      ? animate(x, target, { duration: 0.2 })
      : animate(x, target, { type: "spring", ...springs.gentle });
    return () => controls.stop();
  }, [pageC, width, reduced, x]);

  const onDragEnd = useCallback(
    (_: unknown, info: { offset: { x: number }; velocity: { x: number } }) => {
      const far = Math.abs(info.offset.x) > width * SWIPE_DISTANCE;
      const fast = Math.abs(info.velocity.x) > SWIPE_VELOCITY;
      let next = pageC;
      if ((far || fast) && info.offset.x < 0) next = Math.min(last, pageC + 1);
      else if ((far || fast) && info.offset.x > 0) next = Math.max(0, pageC - 1);
      if (next === pageC) {
        // wróć na miejsce (effect się nie uruchomi, bo strona bez zmiany)
        void animate(x, -pageC * width, { type: "spring", ...springs.gentle });
      }
      setPage(next);
      setTimeout(() => (dragged.current = false), 0);
    },
    [last, pageC, width, x],
  );

  // ─── edytor układu ───

  const commit = useCallback((next: string[], persist = true) => {
    live.current.ids = next;
    setIds(next);
    if (persist) saveLayout(next);
  }, []);

  const stopGesture = useCallback(() => {
    const g = gesture.current;
    if (g) clearInterval(g.edgeTimer);
    gesture.current = null;
    window.removeEventListener("pointermove", onMoveRef.current);
    window.removeEventListener("pointerup", onUpRef.current);
    window.removeEventListener("pointercancel", onUpRef.current);
  }, []);

  const onMoveRef = useRef<(e: PointerEvent) => void>(() => {});
  const onUpRef = useRef<(e: PointerEvent) => void>(() => {});

  onMoveRef.current = (e: PointerEvent) => {
    const g = gesture.current;
    if (!g || e.pointerId !== g.pid) return;
    pointer.current = { x: e.clientX, y: e.clientY };
    if (g.mode === "armed") {
      if (Math.hypot(e.clientX - g.sx, e.clientY - g.sy) < DRAG_START_PX) return;
      g.mode = "drag";
      dragged.current = true;
      const w = live.current.ids.length ? getWidgets().find((d) => d.id === g.id) : undefined;
      setDrag({ id: g.id, w: g.w, h: g.h, label: w?.label ?? g.id });
    }
    if (ghost.current) ghost.current.style.transform = `translate(${e.clientX - g.ox}px, ${e.clientY - g.oy}px)`;

    const els = document.elementsFromPoint(e.clientX, e.clientY) as HTMLElement[];
    const now = performance.now();
    if (now - g.lastReorder > REORDER_COOLDOWN_MS) {
      const cell = els.find((el) => el.dataset?.widgetId && el.dataset.widgetId !== g.id);
      const pageEl = cell ? undefined : els.find((el) => el.dataset?.page !== undefined);
      let next: string[] | null = null;
      if (cell) next = dropOnId(live.current.ids, g.id, cell.dataset.widgetId!);
      else if (pageEl) {
        const pi = Number(pageEl.dataset.page);
        const pageIds = (live.current.pages[pi] ?? []).map((p) => p.widget.id);
        // pusta przestrzeń strony; nie ruszaj, gdy kafel już jest na tej stronie
        if (!pageIds.includes(g.id)) next = dropOnPageEnd(live.current.ids, g.id, pageIds);
      }
      if (next && next.join() !== live.current.ids.join()) {
        g.lastReorder = now;
        commit(next, false);
      }
    }

    // przewracanie strony przy krawędzi viewportu
    const vp = viewport.current?.getBoundingClientRect();
    if (vp) {
      const dir: -1 | 0 | 1 = e.clientX < vp.left + EDGE_PX ? -1 : e.clientX > vp.right - EDGE_PX ? 1 : 0;
      if (dir !== g.edgeDir) {
        g.edgeDir = dir;
        clearInterval(g.edgeTimer);
        if (dir !== 0)
          g.edgeTimer = window.setInterval(() => {
            const { page: p, last: l } = live.current;
            setPage(Math.max(0, Math.min(l, p + dir)));
          }, EDGE_DWELL_MS);
      }
    }
  };

  onUpRef.current = (e: PointerEvent) => {
    const g = gesture.current;
    if (!g || e.pointerId !== g.pid) return;
    const wasDrag = g.mode === "drag";
    stopGesture();
    if (wasDrag) {
      saveLayout(live.current.ids);
      setDrag(null);
      setTimeout(() => (dragged.current = false), 0);
    }
  };

  const arm = useCallback(
    (d: { id: string; pid: number; x: number; y: number; rect: DOMRect }) => {
      stopGesture();
      gesture.current = {
        id: d.id,
        pid: d.pid,
        sx: d.x,
        sy: d.y,
        ox: d.x - d.rect.left,
        oy: d.y - d.rect.top,
        w: d.rect.width,
        h: d.rect.height,
        mode: "armed",
        lastReorder: 0,
        edgeDir: 0,
        edgeTimer: 0,
      };
      pointer.current = { x: d.x, y: d.y };
      window.addEventListener("pointermove", onMoveRef.current);
      window.addEventListener("pointerup", onUpRef.current);
      window.addEventListener("pointercancel", onUpRef.current);
    },
    [stopGesture],
  );

  useEffect(() => stopGesture, [stopGesture]);

  // pozycja ducha tuż po jego zamontowaniu (zanim przyjdzie kolejny pointermove)
  useLayoutEffect(() => {
    const g = gesture.current;
    if (drag && g && ghost.current)
      ghost.current.style.transform = `translate(${pointer.current.x - g.ox}px, ${pointer.current.y - g.oy}px)`;
  }, [drag]);

  const onCellPointerDown = (e: React.PointerEvent<HTMLDivElement>, id: string) => {
    if (e.button !== 0 || (e.target as HTMLElement).closest("[data-remove]")) return;
    const d = { id, pid: e.pointerId, x: e.clientX, y: e.clientY, rect: e.currentTarget.getBoundingClientRect() };
    lastDown.current = d;
    if (editing) arm(d);
  };

  const enterEditing = () => {
    setEditing(true);
    navigator.vibrate?.(15);
    // palec nadal na kaflu → od razu można przeciągać
    const d = lastDown.current;
    if (d) arm(d);
  };

  const exitEditing = () => {
    stopGesture();
    setDrag(null);
    setEditing(false);
    saveLayout(live.current.ids);
  };

  const remove = (id: string) => commit(removeId(live.current.ids, id));

  if (pages.length === 0 && !editing)
    return (
      <div className="home">
        <div className="empty">Brak widgetów — features rejestrują je przez registerWidget()</div>
        <div className="home__foot">
          <GlassButton size="md" icon={<Icon name="plus" />} label="Dodaj widget" onPress={() => setEditing(true)} />
        </div>
      </div>
    );

  const addable = addableWidgets(ids);

  return (
    <div className="home" data-editing={editing || undefined} data-dragging={drag ? "true" : undefined}>
      <div className="home__viewport" ref={viewport}>
        <motion.div
          className="home__track"
          style={{ x }}
          drag={pages.length > 1 && !editing ? "x" : false}
          dragDirectionLock
          dragElastic={0.15}
          dragMomentum={false}
          dragConstraints={{ left: -last * width, right: 0 }}
          onDragStart={() => (dragged.current = true)}
          onDragEnd={onDragEnd}
          onClickCapture={(e) => {
            // po przeciągnięciu / w trybie edycji puszczenie palca nie jest tapnięciem kafla
            if (dragged.current || (editing && !(e.target as HTMLElement).closest("[data-remove]"))) e.stopPropagation();
          }}
        >
          {pages.map((items, i) => (
            <div
              className="home__page"
              key={i}
              data-page={i}
              aria-hidden={i !== pageC}
              style={{
                gridTemplateColumns: `repeat(${GRID_COLS}, 1fr)`,
                gridTemplateRows: `repeat(${GRID_ROWS}, 1fr)`,
              }}
            >
              {items.map(({ widget: w, col, row, w: cw, h: ch }, n) => (
                <div
                  key={w.id}
                  className="home__cell"
                  data-widget-id={w.id}
                  data-dragged={drag?.id === w.id || undefined}
                  style={{
                    gridColumn: `${col + 1} / span ${cw}`,
                    gridRow: `${row + 1} / span ${ch}`,
                    ["--jig-delay" as string]: `${-((n * 83) % 240)}ms`,
                  }}
                  onPointerDown={(e) => onCellPointerDown(e, w.id)}
                >
                  <GlassCard
                    size={w.size}
                    {...(editing
                      ? {}
                      : {
                          onLongPress: enterEditing,
                          ...(w.opens ? { onPress: () => navigate(w.opens!) } : {}),
                        })}
                  >
                    <div className="home__content" inert={editing || undefined}>
                      <w.component size={w.size} />
                    </div>
                  </GlassCard>
                  {editing ? (
                    <button
                      type="button"
                      className="home__remove"
                      data-remove
                      aria-label={`Usuń ${w.label}`}
                      onClick={() => remove(w.id)}
                    >
                      <Icon name="close" />
                    </button>
                  ) : null}
                </div>
              ))}
            </div>
          ))}
          {pages.length === 0 ? (
            <div className="home__page home__page--empty" data-page={0}>
              <div className="empty">Pusto — dodaj widget przyciskiem „Dodaj”</div>
            </div>
          ) : null}
        </motion.div>
      </div>

      <div className="home__foot">
        {editing ? (
          <GlassButton
            size="md"
            icon={<Icon name="plus" />}
            label="Dodaj"
            disabled={addable.length === 0}
            onPress={() => setAddOpen(true)}
          />
        ) : null}
        {pages.length > 1 ? (
          <div className="home__dots" role="tablist">
            {pages.map((_, i) => (
              <button
                key={i}
                type="button"
                role="tab"
                aria-selected={i === pageC}
                aria-label={`Strona ${i + 1}`}
                data-active={i === pageC || undefined}
                onClick={() => setPage(i)}
              />
            ))}
          </div>
        ) : (
          <span />
        )}
        {editing ? <GlassButton size="md" variant="filled" label="Gotowe" onPress={exitEditing} /> : null}
      </div>

      {drag ? (
        <div className="home__ghost" ref={ghost} style={{ width: drag.w, height: drag.h }} aria-hidden>
          {drag.label}
        </div>
      ) : null}

      <Sheet open={addOpen} onClose={() => setAddOpen(false)} title="Dodaj widget">
        {addable.length === 0 ? (
          <p className="center-hint">Wszystkie dostępne widgety są już na ekranie.</p>
        ) : (
          <div className="home__addlist">
            {addable.map((w) => (
              <GlassButton
                key={w.id}
                size="lg"
                label={w.label}
                onPress={() => {
                  commit(addId(live.current.ids, w.id));
                  setAddOpen(false);
                  setPage(Number.MAX_SAFE_INTEGER); // clamp do ostatniej strony
                }}
              />
            ))}
          </div>
        )}
      </Sheet>
    </div>
  );
}
