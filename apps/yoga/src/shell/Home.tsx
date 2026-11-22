/**
 * Home w stylu CarPlay: strony siatki 4×2 z kafli (WidgetDef z registry), swipe poziomy między stronami,
 * kropki stron. Układ z localStorage (edycja w M4). Bez gestów od krawędzi ekranu (DESIGN §7).
 */
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { animate, motion, useMotionValue, useReducedMotion } from "motion/react";
import { springs } from "@yoga-auto/design-tokens";
import { GlassCard } from "@yoga-auto/glass-ui";
import { navigate } from "../core/router.ts";
import { paginate, resolveWidgets, GRID_COLS, GRID_ROWS } from "./homeLayout.ts";

const SWIPE_DISTANCE = 0.18; // część szerokości
const SWIPE_VELOCITY = 450; // px/s

export function Home() {
  const pages = useMemo(() => paginate(resolveWidgets()), []);
  const [page, setPage] = useState(0);
  const viewport = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  const x = useMotionValue(0);
  const reduced = useReducedMotion();
  const dragged = useRef(false);

  useLayoutEffect(() => {
    const el = viewport.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setWidth(el.clientWidth));
    ro.observe(el);
    setWidth(el.clientWidth);
    return () => ro.disconnect();
  }, []);

  const last = Math.max(0, pages.length - 1);
  useEffect(() => {
    const target = -page * width;
    const controls = reduced
      ? animate(x, target, { duration: 0.2 })
      : animate(x, target, { type: "spring", ...springs.gentle });
    return () => controls.stop();
  }, [page, width, reduced, x]);

  const onDragEnd = useCallback(
    (_: unknown, info: { offset: { x: number }; velocity: { x: number } }) => {
      const far = Math.abs(info.offset.x) > width * SWIPE_DISTANCE;
      const fast = Math.abs(info.velocity.x) > SWIPE_VELOCITY;
      let next = page;
      if ((far || fast) && info.offset.x < 0) next = Math.min(last, page + 1);
      else if ((far || fast) && info.offset.x > 0) next = Math.max(0, page - 1);
      if (next === page) {
        // wróć na miejsce (effect się nie uruchomi, bo `page` bez zmian)
        void animate(x, -page * width, { type: "spring", ...springs.gentle });
      }
      setPage(next);
      setTimeout(() => (dragged.current = false), 0);
    },
    [last, page, width, x],
  );

  if (pages.length === 0)
    return <div className="empty">Brak widgetów — features rejestrują je przez registerWidget()</div>;

  return (
    <div className="home">
      <div className="home__viewport" ref={viewport}>
        <motion.div
          className="home__track"
          style={{ x }}
          drag={pages.length > 1 ? "x" : false}
          dragDirectionLock
          dragElastic={0.15}
          dragMomentum={false}
          dragConstraints={{ left: -last * width, right: 0 }}
          onDragStart={() => (dragged.current = true)}
          onDragEnd={onDragEnd}
          onClickCapture={(e) => {
            // po przeciągnięciu nie traktuj puszczenia palca jako tapnięcia kafla
            if (dragged.current) e.stopPropagation();
          }}
        >
          {pages.map((items, i) => (
            <div
              className="home__page"
              key={i}
              aria-hidden={i !== page}
              style={{
                gridTemplateColumns: `repeat(${GRID_COLS}, 1fr)`,
                gridTemplateRows: `repeat(${GRID_ROWS}, 1fr)`,
              }}
            >
              {items.map(({ widget: w, col, row, w: cw, h: ch }) => (
                <div
                  key={w.id}
                  className="home__cell"
                  style={{ gridColumn: `${col + 1} / span ${cw}`, gridRow: `${row + 1} / span ${ch}` }}
                >
                  <GlassCard size={w.size} {...(w.opens ? { onPress: () => navigate(w.opens!) } : {})}>
                    <w.component size={w.size} />
                  </GlassCard>
                </div>
              ))}
            </div>
          ))}
        </motion.div>
      </div>
      {pages.length > 1 ? (
        <div className="home__dots" role="tablist">
          {pages.map((_, i) => (
            <button
              key={i}
              type="button"
              role="tab"
              aria-selected={i === page}
              aria-label={`Strona ${i + 1}`}
              data-active={i === page || undefined}
              onClick={() => setPage(i)}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}
