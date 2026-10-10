# Skaner ICT – test złoty

Setupy wskazane przez użytkownika (11.10.2026): 4 screeny TradingView (XAUUSD, OANDA, H1, strefa czasowa wykresu
= New York) + eksport H1 z TradingView (22.03–9.10.2026). Poziomy odczytane z narzędzia Long/Short Position
(etykiety „Stop” / „Target” / „Risk/reward”), czasy dopasowane do świec H1 z eksportu. Screeny i CSV nie są w repozytorium
(repo publiczne); tu tylko daty i poziomy.

Skaner musi wykryć te setupy z poziomami zbliżonymi do oznaczeń użytkownika (sekcja 13.1 specyfikacji). Różnicę wynikającą
z feedu (EODHD vs OANDA) dokumentujemy przy teście w fazie 3.

## Setupy

Czas = czas NY, świeca H1 = godzina otwarcia. Wynik policzony na świecach H1 z eksportu TradingView (OANDA).

| # | Instrument, kierunek | Kontekst (sweep / displacement) | Wejście | SL | TP | R:R | Wynik |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Z1 | XAUUSD short | Szczyt 4510,93 (czw 3.09, 11:00); konsolidacja; displacement w dół pt 4.09 08:00–09:00 (4476,7 → 4376,2; pierwszy piątek miesiąca – prawdopodobnie NFP 08:30); powrót do „60 FVG” | pt 4.09, świeca 11:00, **4448,30** | **4492,65** (44,35 USD) | **4291,10** | 3,54 | TP pon 14.09 05:00 |
| Z2 | XAUUSD long | Dołek 3996,06 (śr 29.07); wejście na górnej krawędzi bycz. „60 FVG” | **4022,04** – pt 31.07 świeca 10:00 *albo* pon 3.08 świeca 09:00 (do potwierdzenia) | **3998,245** (23,80 USD) | **4113,532** | 3,85 | TP wt 4.08 22:00 |
| Z3 | XAUUSD short | Nowy szczyt 4382,62 (śr 17.06, 13:00); displacement w dół 14:00–16:00 (4379,5 → 4219,2; środa 14:00 – możliwa decyzja FOMC); powrót do „60 FVG” | śr 17.06, świeca 21:00, **4326,80** | **4383,40** (56,60 USD) | **4040,50** | 5,06 | TP śr 24.06 07:00 |
| Z4 | XAUUSD short | Szczyt 4891,54 (pt 17.04, 09:00 – w oknie NY AM); powrót do „60 FVG” | pon 20.04, świeca 18:00, **4829,59** | **4892,22** (62,63 USD; 0,68 nad szczytem) | **4504,51** | 5,19 | TP pon 4.05 12:00 |

Wszystkie cztery osiągnęły TP; największy ruch przeciwny po wejściu (MAE) ≤ 0,12 R.

## Rozbieżności ze specyfikacją (do decyzji użytkownika przed fazą 3)

| # | Godzina wejścia NY | W oknie modeli (02:00–04:40, 07:00–10:00)? | SL (USD) | ≤ maks. SL złota 26 USD? | Strefa wejścia | Czas trwania |
| --- | --- | --- | --- | --- | --- | --- |
| Z1 | 11:00–12:00 | nie (SB 10–11 też minął) | 44,35 | nie | H1 FVG | 10 dni |
| Z2 | 10:00–11:00 albo 09:00–10:00 | tylko wariant 09:00 | 23,80 | tak | H1 FVG | 2–4 dni |
| Z3 | 21:00–22:00 | nie | 56,60 | nie | H1 FVG | 7 dni |
| Z4 | 18:00–19:00 | nie | 62,63 | nie | H1 FVG | 14 dni |

1. **Okna czasowe.** Specyfikacja (sekcja 6): sweep i wejście w oknie, setup wygasa z końcem okna. Trzy z czterech wejść są
   poza oknami (11:00, 18:00, 21:00 NY), sweepy też w większości poza oknami (Z4 wyjątek).
2. **Interwał.** Modele w specyfikacji działają na M5 i M15. Tutaj strefą wejścia jest **H1 FVG**, a setup trwa dni.
3. **Maksymalny SL.** Wyliczony z ADR (20 p EURUSD ≈ 32% ADR → ≈ 26 USD dla złota). Trzy z czterech SL są 1,7–2,4 × większe;
   skaner z domyślnymi parametrami odrzuciłby je z powodem „SL powyżej maksimum”.
4. **Cele.** TP to ruchy 3,5–6,7%, R:R 3,5–5,2 – cele z wyższego interwału (D/W), nie „pierwsza pula − 4 pipsy”.

Wniosek: te setupy to **model swingowy na H1** (sweep / szczyt → displacement → powrót do 60 FVG), a specyfikacja opisuje
modele intraday M5/M15 w killzone'ach. Bez decyzji test złoty nie przejdzie z założenia. Warianty – w `postep.md`
(otwarte pytania).
