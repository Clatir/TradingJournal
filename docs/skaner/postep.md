# Skaner ICT – postęp

Czytaj razem z `specyfikacja.md` na początku każdej sesji. Aktualizuj po każdym znaczącym kroku.

## Bieżący etap

**Faza 2: silnik ICT – UKOŃCZONA (przystanek, czeka na sprawdzenie przez użytkownika)** (start 11.10.2026 ~02:00 PL,
koniec ~02:50 PL + CI; Fable 5.1 xhigh). CI zielone (przebieg 115, z exe i E2E na Windows; po drodze poprawka
niestabilnego testu licznika EODHD na Node 24 – `UsageCounter.flush()`). Faza 1 ukończona w części historycznej; pomiary live zaplanowane automatycznie:
nd 11.10 23:35 PL (Asia) i pn 12.10 08:40 PL (London) – przypomnienia w tej sesji.

| # | Podzadanie fazy 2 | Stan |
| --- | --- | --- |
| 1 | Typy obiektów, parametry detektorów (`settings.scanner.detectors`), okna czasowe (`shared/scanner/detectors/types.ts`, `params.ts`, `windows.ts`) | ✅ |
| 2 | Detektory jednego interwału (`detectors/interval.ts`): swingi z klasami, EQH/EQL, FVG ze stanami, displacement, BPR, VI, MSS/BOS, OB/breaker/mitigation, rejection, OTE, dealing range, sweepy | ✅ |
| 3 | Poziomy (`detectors/levels.ts`): PDH/PDL, PWH/PWL, PMH/PML, IPDA 20/40/60, sesje, otwarcia, NDOG/NWOG; ranga pul; `SymbolEngine` + `analyzeSeries` (`engine.ts`) | ✅ |
| 4 | Testy (`tests/unit/scanner-detectors.test.ts`, 37): pozytywne/negatywne/brzegowe, przyrostowo = wsadowo, brak zaglądania w przyszłość (losowe serie) | ✅ commit 33df8d7 |
| 5 | Warstwy na wykresie (`renderer/features/scanner/analysis.ts`, `layers.ts`, `primitives.ts`): FVG z etykietami 60/240/D, OB/breaker/BPR, pule z rangą, sweepy, MSS/BOS, DR/OTE, otwarcia i luki, tła okien, swingi; przełączniki w localStorage; `tests/unit/scanner-layers.test.ts` (8), E2E | ✅ commit 4562f62 |
| 6 | `definicje.md` (wersja zaimplementowana), `decyzje.md`, oszacowania, CI | ✅ |

Faza 1 (dane): podzadania 1–6 ✅, 7 (E2E, DXY/EURX ✅; **pomiary po otwarciu rynku** ⏳).

## Ukończone

- Specyfikacja przeniesiona do `docs/skaner/specyfikacja.md` (wersja z tabelą modeli „do resetu / po resecie”).
- Sekcja w `CLAUDE.md` wskazująca na pliki skanera (+ zasada: oszacowanie czasu przed każdą fazą).
- Krok 1: rozpoznanie repozytorium dziennika i EODHD, test wykonalności (punkty 2, 3, 4, 6, 7 – bez ostatecznego
  bid/mid; 1 częściowo): `docs/skaner/rozpoznanie.md`.
- Krok 2: plan `docs/skaner/plan.md` (architektura, dane, fazy z oszacowaniem czasu, ryzyka, pytania).
- Odpowiedzi użytkownika na pytania planu i założenia: `docs/skaner/decyzje.md`.
- Faza 1 (część historyczna): magazyn świec M1, klienci EODHD, backfill, zakładka Skaner, Ustawienia → Skaner, E2E
  z fałszywym EODHD, DXY i EURX zweryfikowane (CI zielone, przebieg 105).
- Faza 2: silnik ICT (detektory, poziomy, ranga pul, batch = live, brak zaglądania w przyszłość), warstwy na wykresie,
  `docs/skaner/definicje.md`. Czas czystej pracy ≈ 50 min + CI (szacunek był 2–4 h).

## W toku / odroczone

- **Faza 1 – zostały tylko pomiary na żywo** (po otwarciu rynku): `EODHD_API_TOKEN=… node scripts/eodhd-live-check.mjs 10`
  (z `NODE_USE_ENV_PROXY=1` w chmurze) w sesji Asia (nd wieczór) i London (pn rano). Na ich podstawie: wybór wariantu
  luki (plan sekcja 7: A = uzupełnianie z REST, B = zasobnik i zbieranie w tle), ostateczne bid/mid, wpis do
  `rozpoznanie.md` (3.1, 3.5, 3.7) i `decyzje.md`, potem przystanek fazy 1.

- Test wykonalności po otwarciu rynku (niedziela 11.10, 17:00 NY = 23:00 PL) – w ramach fazy 1:
  - 4.1.1 strumień FX w sesji (ticki, cisza, spread; także `WTIUSD`),
  - 4.1.5 świeżość REST 1m w trakcie sesji → wybór wariantu luki (sekcja 7 planu),
  - 4.1.7: ostateczne bid czy mid (wstępnie bid). Zgodność cen z TradingView zrobiona na eksporcie użytkownika:
    typowo 0,1 p (H1, PDH/PDL), wyjątek świeca 17:00 NY (`rozpoznanie.md` 3.7).

## Następny krok

1. **Odbiór fazy 2 przez użytkownika** (instrukcja w przystanku): otworzyć Skaner (Ctrl+0), wybrać instrument, obejrzeć
   2–3 dni na H1 i M15 z włączonymi warstwami i wypisać, co detektor widzi inaczej (lista poprawek wchodzi do fazy 3).
2. Pomiary live fazy 1 (zaplanowane) → wariant luki, bid/mid, ewentualnie zasobnik → formalne zamknięcie fazy 1.
3. Po słowie „dalej”: **faza 3 – modele wejścia, ocena, cykl życia** (plan sekcja 6 i 14; silnik do wątku main,
   sygnały, bias D/H4/H1/M15, SMT, kolekcja `signals/`). Szacunek po fazie 2: 1,5–3 h (poprawki z odbioru osobno).
   Model: Fable 5.1, xhigh przed resetem limitu (nd 18:00 PL), high po resecie.

## Otwarte pytania (przed fazą 3)

1. **Test złoty – do powtórzenia przez użytkownika przed fazą 3.** Użytkownik dostarczy nowe screeny setupów zgodne
   z nowym paradygmatem (plan sekcja 14: wejście w KZ, top-down D → H4 → H1 → M15). Obecne Z1–Z4
   (`test-zloty.md`) zostają jako materiał pomocniczy; pytanie o moment wejścia Z2 nieaktualne do czasu nowych screenów.
2. **Lista różnic z odbioru fazy 2** – użytkownik porównuje warstwy ze swoim okiem (FVG, OB, pule, sweepy, MSS/BOS);
   znane ograniczenia: brak flagi `incomplete` przy lukach danych, brak liquidity void / PO3 (definicje.md sekcja 10).
