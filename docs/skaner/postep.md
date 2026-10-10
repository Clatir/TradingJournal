# Skaner ICT – postęp

Czytaj razem z `specyfikacja.md` na początku każdej sesji. Aktualizuj po każdym znaczącym kroku.

## Bieżący etap

**Krok 2: plan – napisany (`docs/skaner/plan.md`), przystanek.** Czekam na słowo „akceptuję” (albo uwagi do planu)
przed fazą 1. Odpowiedzi na pytania z sekcji 12 planu wpisać do `decyzje.md`.

## Ukończone

- Specyfikacja przeniesiona do `docs/skaner/specyfikacja.md` (wersja z tabelą modeli „do resetu / po resecie”).
- Sekcja w `CLAUDE.md` wskazująca na specyfikację i ten plik.
- Krok 2: plan `docs/skaner/plan.md` (architektura, dane, fazy, ryzyka, pytania).
- Rozpoznanie repozytorium dziennika i EODHD, test wykonalności (punkty 2, 3, 4, 6 pełne; 1 częściowo):
  `docs/skaner/rozpoznanie.md`.
- Założenia: `docs/skaner/decyzje.md`.

## W toku / odroczone

- Test wykonalności po otwarciu rynku (niedziela 11.10, 17:00 NY = 23:00 PL):
  - 4.1.1 strumień FX w sesji (ticki, cisza, spread),
  - 4.1.5 świeżość REST 1m w trakcie sesji,
  - 4.1.7: ostateczne bid czy mid (wstępnie bid). Zgodność cen z TradingView zrobiona na eksporcie użytkownika:
    typowo 0,1 p (H1, PDH/PDL), wyjątek świeca 17:00 NY (`rozpoznanie.md` 3.7).

## Następny krok

Po „akceptuję”: **faza 1** (warstwa danych i magazyn świec) według sekcji 6 planu. Sugerowany model: Opus 5.5,
xhigh przed resetem limitu (niedziela 11.10.2026 18:00 PL), high po resecie. W fazie 1 domknąć odroczone testy
4.1.1 / 4.1.5 / bid-mid po otwarciu rynku i wybrać wariant luki (sekcja 7 planu).

## Otwarte pytania (do planu)

1. Gałąź: zostać na `claude/quirky-bohr-o95s2l` czy założyć `feature/skaner-ict`?
2. WTI: live jest (`WTIUSD`), historii brak – wariant (zbieranie od zera / drugi dostawca / rezygnacja).
3. Kalendarz makro: EODHD `/economic-events` → 403 w tym planie; inne źródło.
4. Obligacje: brak ZB i intraday Bund – bias D z danych dziennych (FGBLZ26, TYX) + ręczny H4?
5. Magazyn świec bez natywnych modułów (SQLite przez wasm albo własne pliki binarne w userData) – decyzja w planie.
6. Głębokość historii 1m (3 lata dla wszystkich symboli = ok. 1,1 mln świec na symbol).
7. Pytania z sekcji 15 specyfikacji.
