# Skaner ICT – postęp

Czytaj razem z `specyfikacja.md` na początku każdej sesji. Aktualizuj po każdym znaczącym kroku.

## Bieżący etap

**Krok 1: rozpoznanie – ukończony (przystanek).** Czekam na słowo „dalej” przed krokiem 2 (plan).

## Ukończone

- Specyfikacja przeniesiona do `docs/skaner/specyfikacja.md` (wersja z tabelą modeli „do resetu / po resecie”).
- Sekcja w `CLAUDE.md` wskazująca na specyfikację i ten plik.
- Rozpoznanie repozytorium dziennika i EODHD, test wykonalności (punkty 2, 3, 4, 6 pełne; 1 częściowo):
  `docs/skaner/rozpoznanie.md`.
- Założenia: `docs/skaner/decyzje.md`.

## W toku / odroczone

- Test wykonalności po otwarciu rynku (niedziela 11.10, 17:00 NY = 23:00 PL):
  - 4.1.1 strumień FX w sesji (ticki, cisza, spread),
  - 4.1.5 świeżość REST 1m w trakcie sesji,
  - 4.1.7 zgodność cen z TradingView (czeka na odczyt użytkownika, tabela w `rozpoznanie.md` 3.7) oraz bid czy mid.

## Następny krok

Krok 2: `docs/skaner/plan.md` (architektura, technologie, schemat danych, fazy, wynik testu, ryzyka, pytania z sekcji 15).
Sugerowany model: Fable 5.1, xhigh przed resetem limitu (niedziela 11.10.2026 18:00 PL), high po resecie.

## Otwarte pytania (do planu)

1. Gałąź: zostać na `claude/quirky-bohr-o95s2l` czy założyć `feature/skaner-ict`?
2. WTI: live jest (`WTIUSD`), historii brak – wariant (zbieranie od zera / drugi dostawca / rezygnacja).
3. Kalendarz makro: EODHD `/economic-events` → 403 w tym planie; inne źródło.
4. Obligacje: brak ZB i intraday Bund – bias D z danych dziennych (FGBLZ26, TYX) + ręczny H4?
5. Głębokość historii 1m (3 lata dla wszystkich symboli = ok. 1,1 mln świec na symbol).
6. Pytania z sekcji 15 specyfikacji.
