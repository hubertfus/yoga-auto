# Przejęcie pracy na drugim koncie Claude

Cała praca jest **na dysku w git**, a nie na koncie. Nowe konto otwiera te same foldery i kontynuuje.

## 1. Gdzie co leży

| Strumień | Folder (worktree) | Branch | Postęp |
|---|---|---|---|
| lead (main) | `C:\Users\user\Desktop\ets dashboard` | `main` | ten plik, `docs/PLAN.md` |
| S1 plugin | `C:\Users\user\Desktop\ets dashboard\.claude\worktrees\s1-plugin-e4fe7b` | `claude/s1-plugin-e4fe7b` | `docs/progress/s1.md` |
| S2 bridge | `C:\Users\user\Desktop\ets dashboard\.claude\worktrees\s2-bridge-62ab59` | `claude/s2-bridge-62ab59` | `docs/progress/s2.md` |
| S3 glass-ui | `C:\Users\user\Desktop\ets dashboard\.claude\worktrees\s3-glass-ui-ea1fca` | `claude/s3-glass-ui-ea1fca` | `docs/progress/s3.md` |
| S4 shell | `C:\Users\user\Desktop\ets dashboard\.claude\worktrees\s4-shell-1342d1` | `claude/s4-shell-1342d1` | `docs/progress/s4.md` |
| S7 QA | `C:\Users\user\Desktop\ets dashboard\.claude\worktrees\s7-qa-e622ef` | `claude/s7-qa-e622ef` | `docs/progress/s7.md` |

Aktualną listę pokaże:

```powershell
git -C "C:\Users\user\Desktop\ets dashboard" worktree list
```

## 2. Jak przełączyć konto

1. W aplikacji Claude: wyloguj się i zaloguj drugim kontem. Alternatywnie w terminalu uruchom `claude`, a potem `/login`.
2. Dla każdego strumienia otwórz **nową sesję w zakładce Code z folderem z tabeli** (folder worktree, nie główny), model **Sonnet**.
3. Wklej prompt z §3 (podmień `SX`).
4. Sesję leada otwórz w głównym folderze i wklej prompt z §4.

Jeśli limit pierwszego konta się odnowi, możesz wrócić. Stare sesje dalej istnieją, a stan i tak jest w gicie.

## 3. Prompt wznowienia strumienia (wklej w sesji otwartej w folderze worktree)

```
Kontynuujesz strumień SX projektu yoga-auto po poprzedniej sesji, która skończyła się na limicie.
1. Przeczytaj docs/agents/<plik briefu SX>.md (brief + "Stan po Fazie 0") i docs/progress/sX.md (jeśli istnieje).
2. Uruchom: git status, git log --oneline -15. Niezacommitowane zmiany są Twoje, poprzednia sesja nie zdążyła ich zacommitować. Przejrzyj je i dokończ albo zacommituj.
3. npm install, npm run gen, npm run check.
4. Kontynuuj od "następnych kroków" z docs/progress/sX.md. Zasady: edytujesz tylko katalogi strumienia (docs/OWNERSHIP.md) + docs/progress/sX.md, commitujesz często (także wip:), nie pushujesz, nie mergujesz do main, nie zmieniasz brancha. Zmiany kontraktu przez docs/proposals/.
5. Aktualizuj docs/progress/sX.md po każdym kroku. Na końcu raport po polsku: co działa, co zostało.
```

Pliki briefów: S1 `s1-plugin.md`, S2 `s2-bridge.md`, S3 `s3-glass-ui.md`, S4 `s4-shell.md`, S5 `s5-features.md`, S6 `s6-media.md`, S7 `s7-qa.md`, S8 `s8-map.md`.

## 4. Prompt wznowienia leada (sesja w głównym folderze, na `main`)

```
Jesteś leadem projektu yoga-auto (po polsku). Przeczytaj docs/HANDOFF.md, docs/PLAN.md (§0 decyzje, §5 merge, §6 kamienie milowe), docs/OWNERSHIP.md.
Stan: Faza 0 na main (tag contract-v1.0). Fala 1 (S1, S2, S3, S4, S7) pracuje w worktree z tabeli w HANDOFF §1; fala 2 (S5 widgety, S6 media) jeszcze nie ruszyła.
Twoje zadania:
1. Dla każdego brancha strumienia: przeczytaj docs/progress/sX.md i git log; gdy plaster DoD jest gotowy — przejrzyj diff, uruchom npm run check i node scripts/smoke.ts na gałęzi, zmerguj do main (kolejność z PLAN §5), rozwiąż konflikty w plikach root/lockfile.
2. Rozpatrz docs/proposals/* i wprowadź zaakceptowane zmiany kontraktu (PROTOCOL.md §7).
3. Gdy S3 i S4 mają stabilne API na main — uruchom S5 i S6 (briefy w docs/agents/) jako nowe sesje w osobnych worktree, model Sonnet.
4. Nie pushuj nigdzie; wszystko lokalnie.
```

## 5. Zasady, które chronią przed utratą pracy

- Każdy strumień commituje po każdym kroku, a `docs/progress/sX.md` jest „pamięcią” sesji.
- Niezacommitowane zmiany w worktree **nie giną** przy limicie, zostają na dysku dla następnej sesji.
- Nie usuwaj folderów `.claude\worktrees\*`, dopóki lead nie zmerguje brancha.
