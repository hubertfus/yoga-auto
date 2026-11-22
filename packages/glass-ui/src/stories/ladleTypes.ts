import type { FunctionComponent } from "react";

/**
 * Minimalny odpowiednik `Story` z @ladle/react. Nie importujemy typów Ladle, bo jego `.tsx` w node_modules
 * wpada w `tsc` całego repo i psuje `npm run check`. Ladle czyta tylko właściwości funkcji.
 */
export type Story<P = Record<string, never>> = FunctionComponent<P> & {
  storyName?: string;
  args?: Partial<P>;
  argTypes?: Record<string, unknown>;
};
