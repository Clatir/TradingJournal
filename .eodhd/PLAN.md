# Dane rynkowe EODHD – plan (do startu bez kodu)

Status: W TOKU (start 10.10.2026). 1.8.0 gotowe: fundament + 1 (MAE/MFE) + 5 (wykres). 1.9.0 gotowe: 2 + 3 + 4. 1.10.0 gotowe: 6 + 7. Dalej 1.11.0.
Model do implementacji: Opus 5.5, thinking high.

## Sprawdzone na kluczu użytkownika (10.10.2026)
- Plan: 100 000 zapytań / dzień (intraday = 5 zapytań), extraLimit 500.
- M1 forex od ≥ 2010 (2010, 2015, 2020, 2026 OK), tydzień EURUSD = 7196 / 7200 świec; H1, EOD też.
- Są: EURUSD, GBPUSD, EURGBP, AUDUSD, EURAUD, XAUUSD (.FOREX), DXY.INDX, GSPC.INDX, Brent = XBRUSD.FOREX.
- Brak: kalendarz makro (403), obligacje (US10Y 403), WTI (żaden ticker), FGBL / ZB.
- Zgodność z XTB (5 transakcji EURUSD 21–23.09): ceny wejścia/wyjścia w świecy M1 albo 0,1–0,6 p poza nią.
  Short 21.09: szczyt EODHD 1,14921 > SL 1,14898, XTB nie zamknął → potrzebny margines i stan „niepewne”.
- Piątek: świece do 23:59 UTC (rynek zamyka się 21:00) → wypełniacze weekendowe pomijać.
- Nie commitować prawdziwych danych EODHD (repo publiczne, licencja): testy na syntetycznych świecach.

## Decyzje użytkownika
- Cache świec: w folderze danych, ukryty `.market/` (synchronizuje się, offline na drugim komputerze; poza kopiami ZIP,
  skanem i watcherem).
- MAE/MFE z rynku: tylko puste pola; przy wpisanych – różnica + „Użyj danych rynkowych”.
- Missed: wynik z danych tylko, gdy pusty; przy niezgodności podpowiedź.
- Sesje: z killzone'ów w ustawieniach (London z KZ; Azja jako nowy wpis 20:00–00:00 NY, edytowalny).

## Fundament
- Ustawienia → „Dane rynkowe”: klucz (config per komputer, `safeStorage`/DPAPI, nie w journal.json), „Sprawdź
  połączenie” (plan, zużycie), wyłącznik, margines dotknięcia (domyślnie 1 p), rozmiar cache, „Wyczyść”,
  „Pobierz dla całej historii”.
- Pary: `pair.marketSymbol` (addytywne; domyślnie `<SYMBOL>.FOREX`; "" = brak); edycja w zakładce Dane rynkowe.
- Main `src/main/market/`: klient (net.fetch, tylko https poza `ICTJ_MARKET_URL`, `off` w E2E), kolejka, limit,
  cache `.market/<TICKER>/<RRRR>/<RRRR-MM-DD>.m1.json.gz` (dzień UTC, ceny całkowite, kolumny), dzień bieżący
  dociągany do zamknięcia, wypełniacze weekendowe pomijane. Do EODHD idzie tylko symbol i zakres dat.
- IPC `marketBars(symbol, fromUtc, toUtc)`, `marketStatus`, `marketTest`; renderer `store/market.ts`.
- Wyższe interwały liczone z M1 (`shared/calc/market/resample.ts`).
- Pobieranie: na żądanie (edytor, plan dnia, tydzień), w tle po otwarciu folderu (opóźnienie jak NBP) dla
  zamkniętych transakcji bez danych.
- Doprecyzować w CLAUDE.md zasadę „nic nie jest wysyłane” (symbol + daty do EODHD, opcjonalnie).

## Funkcje
1. MAE/MFE z M1 (`excursionsFromBars`) + czas do MAE / MFE, MFE w R, osiągnięte 1R / 2R / TP1 / TP2, SL dotknięty
   tak / nie / niepewne; `trade.market` (addytywne podsumowanie, `source`, `computedAt`), źródło przy polu.
2. Plan dnia: PDH/PDL, PWH/PWL, Azja, Londyn H/L, NY midnight open, true day open → panel „Poziomy z danych”
   + „Dodaj do poziomów kluczowych”; przy transakcji: zebrane płynności przed wejściem (podpowiedź liquidity taken).
3. Missed: co pierwsze po wejściu (TP1 / TP2 / SL / nic) i kiedy; ta sama minuta TP i SL = niepewne.
4. Tydzień: high/low tygodnia i godziny NY high/low dni z danych (pola jak import CSV TV).
5. Wykres w edytorze: lightweight-charts M1/M5/M15/H1, wejście, SL, TP, wyjścia, MAE/MFE, killzone'y, poziomy (2),
   „Kopiuj jako obraz”.
6. Analityka „Co by było, gdyby”: trzymanie do TP1/TP2, BE po 1R, stały cel 2R/3R, partiale; Σ R, WR, DD, różnica
   vs rzeczywistość; niepewne osobno.
7. Zmienność: ATR D14, zakres sesji, SL w ATR, reżim (percentyle) → rozbicie w Analityce i raporcie.
8. Trening z odtwarzaniem: wykres do wejścia, odpowiedź, odsłonięcie przyszłości; karty także bez screenu „przed”.

## Wydania
- 1.8.0: fundament + 1 + 5.
- 1.9.0: 2 + 3 + 4.
- 1.10.0: 6 + 7.
- 1.11.0: 8.
SCHEMA_VERSION bez zmian (wszystko addytywne). Testy: unit (syntetyczne świece), fs (cache), E2E z lokalnym
serwerem EODHD, test na żywo tylko lokalnie z `EODHD_API_TOKEN` (pomijany bez klucza).
