/** Router ekranów z przejściami springiem (gentle): wejście skala .96→1 + opacity; reduced-motion → crossfade. */
import type { ReactNode } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { springs } from "@yoga-auto/design-tokens";

export function Transition({ id, children }: { id: string; children: ReactNode }) {
  const reduced = useReducedMotion();
  return (
    <AnimatePresence mode="popLayout" initial={false}>
      <motion.div
        key={id}
        className="screen"
        initial={reduced ? { opacity: 0 } : { opacity: 0, scale: 0.96 }}
        animate={reduced ? { opacity: 1 } : { opacity: 1, scale: 1 }}
        exit={reduced ? { opacity: 0 } : { opacity: 0, scale: 0.98 }}
        transition={reduced ? { duration: 0.38 } : { type: "spring", ...springs.gentle }}
      >
        {children}
      </motion.div>
    </AnimatePresence>
  );
}
