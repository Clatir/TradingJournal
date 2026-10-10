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
4. **Bezpieczeństwo klucza.** Skrypty testowe czytają `EODHD_API_TOKEN` ze zmiennej środowiskowej, maskują go w każdym
   wypisie i leżą poza repozytorium. Z User API zapisywane są tylko pola techniczne (bez imienia i e-maila).
