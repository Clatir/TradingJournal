# Skaner ICT – postęp

Czytaj razem z `specyfikacja.md` na początku każdej sesji. Aktualizuj po każdym znaczącym kroku.

## Bieżący etap

**Krok 2: plan – gotowy (z sekcją 14: top-down D → H4 → H1 → M15, wejście tylko w KZ, maks. SL 30 p / złoto 65 USD,
premia za konwergencję PDA).** Kod skanera jeszcze nie powstał. Czekam na słowo „akceptuję”, żeby zacząć fazę 1.

## Ukończone

- Specyfikacja przeniesiona do `docs/skaner/specyfikacja.md` (wersja z tabelą modeli „do resetu / po resecie”).
- Sekcja w `CLAUDE.md` wskazująca na pliki skanera (+ zasada: oszacowanie czasu przed każdą fazą).
- Krok 1: rozpoznanie repozytorium dziennika i EODHD, test wykonalności (punkty 2, 3, 4, 6, 7 – bez ostatecznego
  bid/mid; 1 częściowo): `docs/skaner/rozpoznanie.md`.
- Krok 2: plan `docs/skaner/plan.md` (architektura, dane, fazy z oszacowaniem czasu, ryzyka, pytania).
- Odpowiedzi użytkownika na pytania planu i założenia: `docs/skaner/decyzje.md`.

## W toku / odroczone

- Test wykonalności po otwarciu rynku (niedziela 11.10, 17:00 NY = 23:00 PL) – w ramach fazy 1:
  - 4.1.1 strumień FX w sesji (ticki, cisza, spread; także `WTIUSD`),
  - 4.1.5 świeżość REST 1m w trakcie sesji → wybór wariantu luki (sekcja 7 planu),
  - 4.1.7: ostateczne bid czy mid (wstępnie bid). Zgodność cen z TradingView zrobiona na eksporcie użytkownika:
    typowo 0,1 p (H1, PDH/PDL), wyjątek świeca 17:00 NY (`rozpoznanie.md` 3.7).

## Następny krok

Po „akceptuję”: **faza 1** (warstwa danych i magazyn świec) według sekcji 6 planu (bez zmian po sekcji 14). Szacunek: 5–8 h czystej pracy
(+ ok. 0,5 h pomiarów po otwarciu rynku). Model: Opus 5.5, xhigh przed resetem limitu (niedziela 11.10.2026 18:00 PL),
high po resecie.

## Otwarte pytania (przed fazą 3; nie blokują fazy 1)

1. **Test złoty – do powtórzenia przez użytkownika przed fazą 3.** Użytkownik dostarczy nowe screeny setupów zgodne
   z nowym paradygmatem (plan sekcja 14: wejście w KZ, top-down D → H4 → H1 → M15). Obecne Z1–Z4
   (`test-zloty.md`) zostają jako materiał pomocniczy; pytanie o moment wejścia Z2 nieaktualne do czasu nowych screenów.
