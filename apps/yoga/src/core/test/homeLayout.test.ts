// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import type { WidgetDef } from "../registry.ts";
import { DEFAULT_HOME_LAYOUT } from "../registry.ts";
import {
  ADDED_IN_V3,
  addId,
  addableWidgets,
  dropOnId,
  dropOnPageEnd,
  loadLayout,
  migrateToV3,
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

  it("zapisuje v3 i odczytuje", () => {
    saveLayout(["a", "b"]);
    expect(JSON.parse(localStorage.getItem("yoga-auto.home.v3")!)).toEqual({ v: 3, ids: ["a", "b"] });
    expect(loadLayout()).toEqual(["a", "b"]);
  });
  it("migruje v1 (goła tablica) do v3: dokłada mapę i skróty, kasuje stary klucz", () => {
    localStorage.setItem("yoga-auto.home.v1", JSON.stringify(["x", "y"]));
    const expected = [...ADDED_IN_V3.front, "x", "y", ...ADDED_IN_V3.back];
    expect(loadLayout()).toEqual(expected);
    expect(localStorage.getItem("yoga-auto.home.v1")).toBeNull();
    expect(JSON.parse(localStorage.getItem("yoga-auto.home.v3")!).ids).toEqual(expected);
  });
  it("migruje v2 do v3 bez duplikatów (mapa już była)", () => {
    localStorage.setItem("yoga-auto.home.v2", JSON.stringify({ v: 2, ids: ["speed", "map", "sc.trip"] }));
    const got = loadLayout()!;
    expect(got[0]).toBe("map");
    expect(got.filter((x) => x === "sc.trip")).toHaveLength(1);
    expect(got).toEqual(migrateToV3(["speed", "map", "sc.trip"]));
    expect(localStorage.getItem("yoga-auto.home.v2")).toBeNull();
  });
  it("v3 wygrywa z v1/v2", () => {
    localStorage.setItem("yoga-auto.home.v1", JSON.stringify(["old"]));
    localStorage.setItem("yoga-auto.home.v2", JSON.stringify({ v: 2, ids: ["old2"] }));
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
  it("kolejność decyduje o stronie: 18 kafli 1x1 mieści się na 1 stronie (6×3), 19. idzie na drugą", () => {
    const many = Array.from({ length: 19 }, (_, i) => W(`w${i}`));
    const pages = paginate(resolveWidgets(
      many.map((w) => w.id),
      many,
    ));
    expect(pages.map((p) => p.length)).toEqual([18, 1]);
    // przeniesienie ostatniego na początek wypycha dotychczasowy 18. na stronę 2
    const moved = moveId(
      many.map((w) => w.id),
      "w18",
      0,
    );
    const p2 = paginate(resolveWidgets(moved, many));
    expect(p2[1]!.map((x) => x.widget.id)).toEqual(["w17"]);
  });
  it("siatkę można podać jawnie: 8 kafli 1x1 na stronie 4×2", () => {
    const nine = Array.from({ length: 9 }, (_, i) => W(`w${i}`));
    expect(paginate(nine, 4, 2).map((p) => p.length)).toEqual([8, 1]);
  });
  it("domyślny układ: mapa 2×2 w rogu, skróty w dolnym rzędzie (6×3)", () => {
    const mix = [W("map", "2x2"), W("speed", "2x1"), W("nav"), W("job"), W("media", "2x1"), W("lights", "2x1"), ...[1, 2, 3, 4, 5, 6].map((i) => W(`sc${i}`))];
    const pages = paginate(mix);
    expect(pages).toHaveLength(1);
    const at = (id: string) => pages[0]!.find((p) => p.widget.id === id)!;
    expect([at("map").row, at("map").col, at("map").w, at("map").h]).toEqual([0, 0, 2, 2]);
    expect([at("lights").row, at("lights").col]).toEqual([1, 4]);
    expect([1, 2, 3, 4, 5, 6].map((i) => at(`sc${i}`).row)).toEqual([2, 2, 2, 2, 2, 2]);
  });
  it("kafle 2x1 i 1x1 pakują się w siatce 4x2", () => {
    const mix = [W("big", "2x1"), W("s1"), W("s2"), W("big2", "2x1"), W("big3", "2x1")];
    const pages = paginate(mix, 4, 2);
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
