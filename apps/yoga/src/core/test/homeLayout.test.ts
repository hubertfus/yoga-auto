// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import type { WidgetDef } from "../registry.ts";
import { DEFAULT_HOME_LAYOUT } from "../registry.ts";
import {
  addId,
  addableWidgets,
  dropOnId,
  dropOnPageEnd,
  loadLayout,
  moveId,
  paginate,
  parseLayout,
  removeId,
  resetLayout,
  resolveWidgets,
  saveLayout,
} from "../../shell/homeLayout.ts";

const W = (id: string, size: WidgetDef["size"] = "1x1"): WidgetDef => ({
  id,
  label: id.toUpperCase(),
  size,
  component: () => null,
});

describe("zapis układu: wersja schematu i migracja", () => {
  beforeEach(() => localStorage.clear());

  it("zapisuje v2 i odczytuje", () => {
    saveLayout(["a", "b"]);
    expect(JSON.parse(localStorage.getItem("yoga-auto.home.v2")!)).toEqual({ v: 2, ids: ["a", "b"] });
    expect(loadLayout()).toEqual(["a", "b"]);
  });
  it("migruje v1 (goła tablica) do v2 i kasuje stary klucz", () => {
    localStorage.setItem("yoga-auto.home.v1", JSON.stringify(["x", "y"]));
    expect(loadLayout()).toEqual(["x", "y"]);
    expect(localStorage.getItem("yoga-auto.home.v1")).toBeNull();
    expect(JSON.parse(localStorage.getItem("yoga-auto.home.v2")!).ids).toEqual(["x", "y"]);
  });
  it("v2 wygrywa z v1", () => {
    localStorage.setItem("yoga-auto.home.v1", JSON.stringify(["old"]));
    saveLayout(["new"]);
    expect(loadLayout()).toEqual(["new"]);
  });
  it("uszkodzone dane → null (układ domyślny)", () => {
    for (const bad of ["{", "123", '{"v":2}', '{"v":2,"ids":[1]}', '["a",2]', "null"]) {
      expect(parseLayout(bad)).toBeNull();
    }
    localStorage.setItem("yoga-auto.home.v2", "{oops");
    expect(loadLayout()).toBeNull();
  });
  it("duplikaty są usuwane", () => {
    expect(parseLayout('{"v":2,"ids":["a","b","a"]}')).toEqual(["a", "b"]);
  });
  it("reset do domyślnego usuwa oba klucze", () => {
    localStorage.setItem("yoga-auto.home.v1", '["a"]');
    saveLayout(["a"]);
    resetLayout();
    expect(loadLayout()).toBeNull();
    expect(
      resolveWidgets(
        loadLayout(),
        DEFAULT_HOME_LAYOUT.map((id) => W(id)),
      ).map((w) => w.id),
    ).toEqual([...DEFAULT_HOME_LAYOUT]);
  });
});

describe("operacje edytora", () => {
  const ids = ["a", "b", "c", "d"];
  it("moveId", () => {
    expect(moveId(ids, "a", 2)).toEqual(["b", "c", "a", "d"]);
    expect(moveId(ids, "d", 0)).toEqual(["d", "a", "b", "c"]);
    expect(moveId(ids, "b", 99)).toEqual(["a", "c", "d", "b"]);
    expect(moveId(ids, "zzz", 1)).toEqual(ids);
    expect(ids).toEqual(["a", "b", "c", "d"]); // niemutujące
  });
  it("dropOnId zajmuje miejsce celu w obu kierunkach", () => {
    expect(dropOnId(ids, "a", "c")).toEqual(["b", "c", "a", "d"]);
    expect(dropOnId(ids, "d", "b")).toEqual(["a", "d", "b", "c"]);
    expect(dropOnId(ids, "a", "a")).toEqual(ids);
    expect(dropOnId(ids, "a", "nie-ma")).toEqual(ids);
  });
  it("dropOnPageEnd: za ostatnim kaflem strony (przenoszenie między stronami)", () => {
    // strona 2 = [c, d]; przeciągamy a z strony 1
    expect(dropOnPageEnd(ids, "a", ["c", "d"])).toEqual(["b", "c", "d", "a"]);
    // przeciągamy d na stronę 1 = [a, b]
    expect(dropOnPageEnd(ids, "d", ["a", "b"])).toEqual(["a", "b", "d", "c"]);
    // pusta strona → koniec
    expect(dropOnPageEnd(ids, "a", [])).toEqual(["b", "c", "d", "a"]);
    // strona zawiera tylko przeciągany kafel
    expect(dropOnPageEnd(ids, "c", ["c"])).toEqual(["a", "b", "d", "c"]);
  });
  it("addId / removeId", () => {
    expect(addId(ids, "e")).toEqual([...ids, "e"]);
    expect(addId(ids, "a")).toEqual(ids);
    expect(removeId(ids, "b")).toEqual(["a", "c", "d"]);
    expect(removeId(ids, "nie-ma")).toEqual(ids);
  });
  it("addableWidgets: tylko te z rejestru, których nie ma w układzie", () => {
    const all = [W("speed"), W("nav"), W("map")];
    expect(addableWidgets(["speed"], all).map((w) => w.id)).toEqual(["map", "nav"]);
    expect(addableWidgets(["speed", "nav", "map"], all)).toEqual([]);
  });
});

describe("resolveWidgets + paginate z układem użytkownika", () => {
  const all = ["a", "b", "c", "d", "e"].map((id) => W(id));
  it("zapisany układ jest wierny (usunięte nie wracają, nieznane id pomijane)", () => {
    expect(resolveWidgets(["c", "ghost", "a"], all).map((w) => w.id)).toEqual(["c", "a"]);
  });
  it("kolejność decyduje o stronie: 8 kafli 1x1 mieści się na 1 stronie, 9. idzie na drugą", () => {
    const nine = Array.from({ length: 9 }, (_, i) => W(`w${i}`));
    const pages = paginate(resolveWidgets(
      nine.map((w) => w.id),
      nine,
    ));
    expect(pages.map((p) => p.length)).toEqual([8, 1]);
    // przeniesienie ostatniego na początek wypycha dotychczasowy 8. na stronę 2
    const moved = moveId(
      nine.map((w) => w.id),
      "w8",
      0,
    );
    const p2 = paginate(resolveWidgets(moved, nine));
    expect(p2[1]!.map((x) => x.widget.id)).toEqual(["w7"]);
  });
  it("kafle 2x1 i 1x1 pakują się w siatce 4x2", () => {
    const mix = [W("big", "2x1"), W("s1"), W("s2"), W("big2", "2x1"), W("big3", "2x1")];
    const pages = paginate(mix);
    expect(pages).toHaveLength(1);
    expect(pages[0]!.map((p) => [p.widget.id, p.row, p.col])).toEqual([
      ["big", 0, 0],
      ["s1", 0, 2],
      ["s2", 0, 3],
      ["big2", 1, 0],
      ["big3", 1, 2],
    ]);
  });
});
