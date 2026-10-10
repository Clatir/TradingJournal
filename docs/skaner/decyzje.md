# Skaner ICT – decyzje i założenia

Założenia przyjęte w trakcie pracy, gdy specyfikacja milczy albo nie da się jej wykonać dosłownie. Każdy wpis: data, etap,
decyzja, powód.

## Krok 1 (2026-10-10)

1. **Nazwa pliku specyfikacji.** W głównym folderze nie było `specyfikacja.md`; specyfikacją jest plik
   `Skaner ICT — prompt dla Claude Code.md` (wersja z commita `0134798`, z tabelą modeli „do resetu / po resecie”).
   Przeniesiony bez zmian treści do `docs/skaner/specyfikacja.md`.
2. **Gałąź.** Specyfikacja mówi o `feature/skaner-ict`, ale ta sesja ma przydzieloną gałąź
   `claude/quirky-bohr-o95s2l` i nie może pushować na inną bez zgody użytkownika. Krok 1 jest na
   `claude/quirky-bohr-o95s2l`. Do potwierdzenia przy kroku 2: zostać na niej albo założyć `feature/skaner-ict`.
3. **Plugin `eodhd-api`.** Polecenia `/plugin marketplace add` / `/plugin install` są interaktywne i nie da się ich
   wykonać z sesji w chmurze. Repozytorium `EodHistoricalData/eodhd-claude-skills` (commit `9839c79`, 2026-10-10)
   pobrane przez git do katalogu tymczasowego i czytane jako dokumentacja; nie jest częścią repozytorium dziennika.
   Fakty, które miały znaczenie, sprawdzone kluczem użytkownika (patrz `rozpoznanie.md`).
## Krok 2 (2026-10-10, plan do akceptacji)

5. **Wszystko z M1.** Gotowe świece 5m/1h z EODHD pochodzą z innego źródła (różnice ~3 p, błędne świece, brak dla
   złota), więc każdy wyższy interwał składa aplikacja z M1. Głębokość pierwszego pobrania: 14 → 120 → 400 dni 1m
   zamiast „1h z 3 lat” ze specyfikacji.
6. **Magazyn świec = własne pliki binarne** w `userData/scanner/` (bez SQLite: brak natywnych modułów, `sql.js`
   trzyma bazę w pamięci, `node:sqlite` niepewny w Electronie, SQL niepotrzebny).
7. **Pokrycie zamiast luk.** Magazyn zapisuje okresy z potwierdzonymi danymi; luka = godziny rynku poza pokryciem.
8. **Nowe kolekcje w folderze dziennika:** `signals/`, `replays/`, `biases/`, `events/`, `missed/` + `settings.scanner`
   w `journal.json`, `SCHEMA_VERSION` bez zmian. Sygnały z replay trafiają do rekordu przebiegu, nie do `signals/`.
9. **Silnik w wątkach procesu głównego** (live i replay osobno), renderer tylko wyświetla; sieć tylko w main (CSP).
10. **Przełączniki alertów per komputer** (`config.json`), reszta ustawień skanera wspólna – do potwierdzenia (pytanie 10).
11. **Bez osobnego procesu zbierającego** – zbieranie w tle przez zasobnik tej samej aplikacji (wariant B, sekcja 7 planu).
12. **Przeliczenie na PLN przez USD** (USDPLN + pary z USD) zamiast dodatkowych symboli w subskrypcji.
13. **Obligacje:** bias D automatycznie z serii dziennych (TYX jako odwrotność ZB, Bund `FGBLZ<m><r>.US` z rolowaniem),
    H4 ręcznie.
14. **Skrót zakładki `Ctrl+0`** (Ctrl+1…9 zajęte).

## Odpowiedzi użytkownika na pytania planu (2026-10-11)

Użytkownik przyjął wszystkie wartości domyślne z sekcji 12 planu:

1. XAUUSD: pips 0,1 USD, kontrakt 100 uncji, max SL = ułamek ADR20 jak 20 p dla EURUSD (dziś ≈ 26 USD/oz, wyliczany
   na bieżąco, widoczny i edytowalny). WTI: pips 0,01, 1 lot = 1000 baryłek, max SL tymczasowo 2% ceny do zebrania 20 dni.
2. Kapitał, ryzyko i krok lota z istniejących ustawień dziennika (`settings.risk`), waluta konta PLN.
3. Świece z ceny **bid** (ostatecznie po pomiarze w sesji w fazie 1).
4. WTI: wariant A (live `WTIUSD` + historia od włączenia + import CSV z TradingView). Kalendarz: Forex Factory + ręczne.
5. Zbieranie w tle przez zasobnik i start z systemem, jeśli REST okaże się nieświeży.
6. Test złoty: **brak dni** – czeka na wskazanie użytkownika (najpóźniej w fazie 3).
7. Powody ocen: zły bias, słaby displacement, mało istotna płynność, za późno w oknie, przeszkoda przed TP, SL za szeroki,
   za blisko newsów, zła strefa wejścia, inne (edytowalne).
8. **Gałąź: zostajemy na `claude/quirky-bohr-o95s2l`** (odstępstwo od `feature/skaner-ict` ze specyfikacji).
9. Skrót zakładki: `Ctrl+0`.
10. Przełączniki dźwięku i powiadomień per komputer.
11. Alerty przy niepełnej sesji działają z flagą „niepełne dane”.
12. Głębokość historii 1m: 400 dni dla instrumentów, 120 dni dla składników indeksów.
13. Obligacje: TYX (rentowność 30Y) jako odwrotność ZB, Bund tylko dziennie (`FGBLZ<m><r>.US`); H4 ręcznie.

Dodatkowa zasada od użytkownika: **przed każdą fazą podać szacowany czas czystej pracy Claude'a** (tabela w sekcji 6
planu, aktualizowana przed każdą fazą).

## Zmiana paradygmatu (2026-10-11, plan sekcja 14)

Po teście złotym (setupy H1 użytkownika) użytkownik zmienił założenia modeli: analiza top-down D → H4 → H1 → M15,
wejścia na H1 (główne) i M15 (doprecyzowane). Odpowiedzi:

1. Bias: H1 wymaga zgodnego D i H4, M15 dodatkowo H1; H1 pod bias = flaga „kontra”, bez alertu; M15 pod bias = brak
   sygnału. **Zgoda.**
2. Okna: „tylko podczas KZ London i NY” (02:00–04:40, 07:00–10:00 NY); klasyczne okna SB 10–11 i 14–15 odpadają
   **[założenie: SB tylko 03:00–04:00]**. Do potwierdzenia: wymóg okna dla powstania setupu (a) czy także dla wejścia (b);
   do decyzji domyślnie (a) dla H1, (b) dla M15.
3. Setup H1 nie wygasa z końcem okna (FVG zamknięty po drugiej stronie, zamknięcie za ekstremum sweepu, cel bez
   cofnięcia, zmiana biasu D/H4). **Zgoda.**
4. Maksymalny SL: **30 pipsów** (FX, H1 i M15). Złoto/ropa do potwierdzenia: skalowanie ADR (≈ 39 USD dziś) odrzuca
   Z1, Z3, Z4 z testu złotego; alternatywa osobna wartość (np. 65 USD).
5. Alerty H1 przy „uzbrojony” i „gotowy”, M15 przy „gotowy” – brak odpowiedzi, przyjęta propozycja.
6. Skaner ma własny preset złota (pips 0,1 USD, kontrakt 100 oz) – dziennik nie ma presetu XAUUSD.

## Krok 1 – c.d.

4. **Bezpieczeństwo klucza.** Skrypty testowe czytają `EODHD_API_TOKEN` ze zmiennej środowiskowej, maskują go w każdym
   wypisie i leżą poza repozytorium. Z User API zapisywane są tylko pola techniczne (bez imienia i e-maila).
