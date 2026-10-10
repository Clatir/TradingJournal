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

## Krok 1 – c.d.

4. **Bezpieczeństwo klucza.** Skrypty testowe czytają `EODHD_API_TOKEN` ze zmiennej środowiskowej, maskują go w każdym
   wypisie i leżą poza repozytorium. Z User API zapisywane są tylko pola techniczne (bez imienia i e-maila).
