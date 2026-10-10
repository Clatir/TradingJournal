# Skaner ICT – postęp

Czytaj razem z `specyfikacja.md` na początku każdej sesji. Aktualizuj po każdym znaczącym kroku.

## Bieżący etap

**Krok 2: plan – gotowy, odpowiedzi na pytania przyjęte (wszystkie domyślne, gałąź bez zmian).** Przed fazą 1 podane
oszacowanie czasu; czekam na słowo „akceptuję”, żeby zacząć fazę 1.

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

Po „akceptuję”: **faza 1** (warstwa danych i magazyn świec) według sekcji 6 planu. Szacunek: 5–8 h czystej pracy
(+ ok. 0,5 h pomiarów po otwarciu rynku). Model: Opus 5.5, xhigh przed resetem limitu (niedziela 11.10.2026 18:00 PL),
high po resecie.

## Otwarte pytania (do odpowiedzi przed fazą 3; nie blokują fazy 1)

Test złoty: 4 setupy XAUUSD od użytkownika zapisane w `docs/skaner/test-zloty.md`. Wyszły rozbieżności ze specyfikacją:

1. **Model swingowy H1.** Setupy użytkownika to H1 (sweep/szczyt → displacement → powrót do 60 FVG), wejścia poza
   oknami (11:00, 18:00, 21:00 NY), trwające dni. Warianty:
   (a) dodać w fazie 3 piąty model „H1 swing” (wejście bez wymogu okna, ważny do zamknięcia za FVG / unieważnienia,
   własny maks. SL i cele z D/W; alert jak dla innych) – szac. +2–3 h w fazie 3; test złoty = te 4 setupy;
   (b) zostać przy modelach intraday ze specyfikacji, a użytkownik podaje 3–5 przykładów intraday (M5/M15 w oknach);
   (c) oba: (a) + kilka przykładów intraday (najlepiej także pary FX).
2. **Maksymalny SL złota.** SL użytkownika: 23,8 / 44,4 / 56,6 / 62,6 USD; domyślne 26 USD odrzuciłoby 3 z 4.
   Osobny limit dla modelu H1 (np. 65 USD) czy podnieść ogólny?
3. **Z2 – moment wejścia:** pt 31.07 świeca 10:00 NY (pierwsze dotknięcie 4022,04) czy pon 3.08 09:00 NY?
