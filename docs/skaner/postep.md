# Skaner ICT – postęp

Czytaj razem z `specyfikacja.md` na początku każdej sesji. Aktualizuj po każdym znaczącym kroku.

## Bieżący etap

**Faza 1: warstwa danych i magazyn świec – część na danych historycznych UKOŃCZONA (przystanek), część live czeka na
otwarcie rynku** (start 11.10.2026 ~00:55 PL, koniec ~01:55 PL, ok. 1 h; Opus 5.5 xhigh). CI zielone (przebieg 105,
exe z testami E2E na Windows). Pomiary live zaplanowane automatycznie: nd 11.10 23:35 PL (Asia) i pn 12.10 08:40 PL
(London) – przypomnienia w tej sesji. Po każdym podzadaniu commit + push.

| # | Podzadanie | Stan |
| --- | --- | --- |
| 1 | Czas NY i składanie świec (`src/shared/scanner/time.ts`, `aggregate.ts`, `types.ts`, `tests/unit/scanner-time.test.ts`) | ✅ commit 98d976f |
| 2 | Ustawienia skanera (`settings.scanner`), presety instrumentów, parsery EODHD, budżet symboli, M1 z ticków, import CSV TradingView (shared) | ✅ |
| 3 | Magazyn świec w `userData/scanner/` (pliki binarne M1, pokrycie, luki) | ✅ |
| 4 | Klienci EODHD (WebSocket, REST z limiterem), backfill, klucz API (safeStorage) | ✅ |
| 5 | Usługa skanera w main + IPC + preload | ✅ |
| 6 | UI: zakładka Skaner (Ctrl+0, pasek stanu, surowy wykres), Ustawienia → Skaner | ✅ |
| 7 | E2E z lokalnym serwerem EODHD ✅, weryfikacja DXY ✅ i EURX ✅ (Pepperstone = wzór ICE × 9,7544), skrypt pomiarów `scripts/eodhd-live-check.mjs` ✅, **pomiary po otwarciu rynku** (nd 17:00 NY = 23:00 PL) ⏳ | ⏳ |

## Ukończone

- Specyfikacja przeniesiona do `docs/skaner/specyfikacja.md` (wersja z tabelą modeli „do resetu / po resecie”).
- Sekcja w `CLAUDE.md` wskazująca na pliki skanera (+ zasada: oszacowanie czasu przed każdą fazą).
- Krok 1: rozpoznanie repozytorium dziennika i EODHD, test wykonalności (punkty 2, 3, 4, 6, 7 – bez ostatecznego
  bid/mid; 1 częściowo): `docs/skaner/rozpoznanie.md`.
- Krok 2: plan `docs/skaner/plan.md` (architektura, dane, fazy z oszacowaniem czasu, ryzyka, pytania).
- Odpowiedzi użytkownika na pytania planu i założenia: `docs/skaner/decyzje.md`.

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

1. Pomiary live fazy 1 (zaplanowane, patrz wyżej) → wariant luki, bid/mid, ewentualnie zasobnik → formalne zamknięcie fazy 1.
2. Po słowie „dalej”: **faza 2 – silnik ICT** (można zaczynać na danych historycznych przed pomiarami; plan sekcja 6
   i 14). Szacunek po fazie 1: 2–4 h. Model: Fable 5.1, xhigh przed resetem limitu (nd 18:00 PL), high po resecie.

## Otwarte pytania (przed fazą 3; nie blokują fazy 1)

1. **Test złoty – do powtórzenia przez użytkownika przed fazą 3.** Użytkownik dostarczy nowe screeny setupów zgodne
   z nowym paradygmatem (plan sekcja 14: wejście w KZ, top-down D → H4 → H1 → M15). Obecne Z1–Z4
   (`test-zloty.md`) zostają jako materiał pomocniczy; pytanie o moment wejścia Z2 nieaktualne do czasu nowych screenów.
