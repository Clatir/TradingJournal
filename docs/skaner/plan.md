# Skaner ICT – plan (krok 2)

Stan: sobota 10.10.2026. Plan do akceptacji przed fazą 1. Opiera się na `specyfikacja.md` i `rozpoznanie.md`.
Odstępstwa od specyfikacji są oznaczone **[odstępstwo]**, założenia własne **[założenie]** (trafią też do `decyzje.md`).

> **11.10.2026: zmiana paradygmatu (sekcja 14).** Skaner analizuje top-down D → H4 → H1 → M15, wejścia na H1 i M15
> tylko zgodnie z biasem wyższych interwałów. Sekcja 14 ma pierwszeństwo przed sekcjami 0, 4.4, 5.2, 6 (fazy 3–4)
> i 12 tam, gdzie się różnią.

## 0. Najważniejsze decyzje w skrócie

1. Skaner to nowa zakładka dziennika (`Ctrl+0`), ten sam kod, styl i build. Istniejące funkcje bez zmian.
2. Cała łączność z EODHD (WebSocket, REST) i magazyn świec żyją w **procesie głównym** – ekran aplikacji ma politykę
   bezpieczeństwa, która nie pozwala mu łączyć się z siecią, i tak jest w całym dzienniku.
3. **Silnik ICT jest czystym TypeScriptem** w `src/shared/scanner/` (bez Electrona, testowalny w Vitest) i działa
   w wątku roboczym procesu głównego – jeden wątek dla trybu live, osobny dla replay. **Ten sam kod, inne źródło świec.**
4. **Źródłem każdej świecy jest M1.** M5, M15, H1, H4, D, W składa aplikacja (granica doby 17:00 NY, DST przez luxon).
   Gotowych świec 5m/1h z EODHD nie używamy (inne źródło, różnice ~3 pipsy, błędne świece, brak dla złota).
5. **Magazyn świec = własne pliki binarne** w `userData/scanner/` (jeden plik na symbol i miesiąc) + indeks pokrycia.
   Bez SQLite: dziennik nie dopuszcza natywnych modułów, a potrzebny jest tylko zapis sekwencyjny i odczyt zakresów.
6. **Luki są jawne:** magazyn pamięta, dla których okresów ma potwierdzone dane; wszystko inne w godzinach rynku to luka,
   którą widać na kafelku, a detektory oznaczają wynik jako niepewny.
7. **Dane skanera dzielone między komputerami** (sygnały, oceny, nadpisania biasu, zdarzenia, ustawienia) to zwykłe rekordy
   JSON w folderze dziennika – nowe kolekcje + `settings.scanner` w `journal.json`, bez podbijania `SCHEMA_VERSION`.
   Klucz API, cache świec i przełączniki alertów zostają na komputerze.
8. **DXY i EURX liczone z par** (EODHD ma tylko świece dzienne tych indeksów); **obligacje: bias D automatycznie z danych
   dziennych, H4 ręcznie** (EODHD nie ma intraday obligacji ani kontraktu ZB).
9. **WTI: live ze strumienia (`WTIUSD`), historia budowana od włączenia i uzupełniana importem CSV z TradingView.**
   **Kalendarz makro: plik tygodniowy Forex Factory** (EODHD odmawia w tym planie) + ręczne wydarzenia.
10. Wykresy: lightweight-charts 5 (jest w dzienniku), strefy rysowane własnymi prymitywami biblioteki.

## 1. Wynik testu wykonalności (skrót)

Szczegóły w `rozpoznanie.md`, sekcja 3.

| Punkt | Wynik | Wpływ na plan |
| --- | --- | --- |
| 1. Strumień FX | Wszystkie instrumenty startowe, złoto, USDPLN i składniki DXY/EURX istnieją w strumieniu (migawka przy zamkniętym rynku). Limit 50 symboli jest **na klucz**, przekroczenie odrzuca całą subskrypcję. Budżet listy startowej: 16 z 50. Czy każdy symbol streamuje w sesji: **odroczone do otwarcia rynku** | Budżet symboli liczony przed wysłaniem, obsługa `Symbols limit reached`; wykrywanie ciszy pomija migawkę |
| 2. Złoto | Na liście FOREX, w strumieniu, historia **tylko 1m** (co najmniej od 2023) | Wszystko z 1m (dotyczy też FX) |
| 3. WTI | `WTIUSD` tylko w strumieniu; REST: 404, Commodities API: dane dzienne FRED z tygodniowym opóźnieniem | Sekcja 8 |
| 4. Indeksy i obligacje | DXY/EURX tylko dziennie; `NYICDX` 1h w godzinach USA; ZB brak; rentowność 30Y (`TYX`) 1h w godzinach USA; Bund `FGBLZ26.US` tylko dziennie | Sekcje 5.6 i 10 |
| 5. Świeżość REST | **Odroczone** (rynek zamknięty); dokumentacja: finalizacja 2–3 h po zamknięciu | Sekcja 7: dwa warianty, decyzja w fazie 1 |
| 6. Kalendarz | `/economic-events` → 403 | Sekcja 9 |
| 7. Zgodność cen | Świece z 1m vs TradingView OANDA: typowo 0,1 pipsa, PDH/PDL do 0,4 p; wyjątek świeca 17:00 NY (do 9 p). Bid/mid: wstępnie bid | Domyślnie bid; NDOG/NWOG z zastrzeżeniem |

Plan EODHD: 100 000 wywołań dziennie (intraday = 5 za zapytanie), 1000 zapytań na minutę, 64 połączenia WS.

## 2. Architektura

### 2.1 Zasady nadrzędne (ze specyfikacji) i jak są egzekwowane

- **Tylko zamknięte świece, bez zaglądania w przyszłość.** Detektor dostaje strumień zdarzeń „zamknięta świeca
  interwału X” i nie ma dostępu do świecy w budowie. Każdy detektor ma wersję przyrostową (stan + `onCandle`) i wersję
  wsadową (czysta funkcja na tablicy świec) – test porównuje obie dla każdego `n` (sekcja 13.1 specyfikacji).
- **Live = replay.** Jeden `SymbolEngine`; w trybie live zasila go `M1Builder` z ticków, w replay `ReplayFeeder`
  z magazynu. Zegar silnika to czas ostatniej zamkniętej świecy, nie zegar systemowy (dzięki temu okna czasowe
  i wygaśnięcia działają identycznie). Test: ten sam dzień z magazynu → te same sygnały co zapisane na żywo.

### 2.2 Procesy i wątki

```
┌───────────── renderer (React) ─────────────┐      IPC (invoke/event)      ┌────────────── main ──────────────┐
│ features/scanner: pulpit, lista, karta,    │ ◄──────────────────────────► │ scanner/ipc.ts    (kontrakt)      │
│ wykres, bias, briefing, replay, statystyki │   scanner:event (push)        │ scanner/eodhd/ws.ts   WebSocket   │
│ store/scanner.ts (zustand)                 │                               │ scanner/eodhd/rest.ts limiter,    │
│ charts: lightweight-charts + prymitywy     │                               │   licznik, cache                  │
└────────────────────────────────────────────┘                               │ scanner/store/   magazyn świec    │
                                                                              │ scanner/m1.ts    ticki → M1       │
                                                                              │ scanner/calendar.ts, alerts.ts,   │
                                                                              │   tray.ts, apiKey.ts              │
                                                                              │ scanner/host.ts  ⇄ wątki:         │
                                                                              │   worker „live”  (SymbolEngine×N) │
                                                                              │   worker „replay”(SymbolEngine×N) │
                                                                              └───────────────────────────────────┘
```

- **Main** jest właścicielem połączeń, magazynu i alertów; sam nie liczy detektorów.
- **Wątek „live”** (`?nodeWorker`, jak OCR) trzyma serie świec wszystkich symboli i silniki; dostaje zamknięte M1,
  odsyła zmiany obiektów i sygnałów. Przeliczenia są przyrostowe (sekcja 5.1).
- **Wątek „replay”** – ta sama klasa, zasilana z magazynu; może iść z dowolną prędkością bez wpływu na live.
- **Renderer** dostaje zdarzenia zbiorcze, nie więcej niż 4 na sekundę (ticki są buforowane w main), i pobiera serie
  świec na żądanie (wykres szczegółowy). Przy zamkniętym oknie (zasobnik) renderer nie jest potrzebny: zbieranie
  ticków i alerty działają w main.

### 2.3 Przepływ danych

1. Tick WS `{s, a, b, t}` → `M1Builder` (bid albo mid) → zamknięta świeca M1 (przy ticku z następnej minuty albo
   po timerze „koniec minuty + 2 s”) → **magazyn** (append) + **wątek live**.
2. Wątek live: `Aggregator` domyka M5/M15/H1/H4/D/W (sekcja 4.2) → `SymbolEngine.onClose(interval, candle)` →
   detektory → `Levels` (rejestr pul płynności i PD arrays z rangą między interwałami) → modele wejścia → `Lifecycle`
   (etapy sygnałów) → `Score` → zdarzenia `objects`, `signal`, `bias`.
3. Main: sygnały → zapis rekordu w folderze dziennika (`DataStore`), alerty (dźwięk/powiadomienie), push do renderera.
4. Przy starcie i po każdym wznowieniu: `Backfill` pyta REST o brakujący zakres, dopisuje świece, rozszerza pokrycie;
   luki pozostałe są widoczne i ponawiane co 15 min.
5. Replay: `ReplayFeeder` czyta M1 z magazynu (po wcześniejszym załadowaniu historii HTF), zasila silniki w wątku replay;
   sygnały trafiają do rekordu przebiegu (`replays/<id>.json`), nie do `signals/`.

### 2.4 Moduły i pliki

```
src/shared/scanner/            czysty TS (tsconfig.node + web)
  types.ts                     Candle, Interval, Series, Level, Signal, Stage, …
  time.ts                      doba handlowa 17:00 NY, tydzień, sesje, okna, DST (luxon), minuteIndex
  aggregate.ts                 M1 → M5/M15/H1/H4/D/W, poziomy otwarcia, NDOG/NWOG
  pips.ts                      pips instrumentu, zaokrąglenia
  detectors/                   swings, structure (MSS/BOS), displacement, fvg, orderBlock, breaker, liquidity
                               (pule, EQH/EQL, sweep, sesje, PDH/PDL, IPDA), dealingRange, ote, opens, extensions
  levels.ts                    rejestr poziomów, zbieżność i ranga między interwałami
  models/                      model1Sweep, model2Ote, model3SilverBullet, model4TurtleBreaker, merge
  setup/                       entry (krawędź + CE), stop (A/B, bufor, kontrole), target (TP1/TP2, przeszkody),
                               score (punkty, A/B/C), lifecycle (etapy, unieważnienia, wygaśnięcia)
  bias.ts                      propozycja biasu W/D/H4/H1 + DOL, pewność, powody; nadpisania
  synthetic.ts                 DXY, EURX z par (tick po ticku i z M1)
  smt.ts, exposure.ts          SMT divergence, „ta sama ekspozycja”
  intermarket.ts               spójność waluta / indeks / obligacje
  news.ts                      dzień HIN, okno publikacji, cele na dane
  engine.ts                    SymbolEngine (orkiestracja), EngineHost (wiele symboli)
  replay.ts                    feeder, symulacja wyniku (wejście krawędź/CE, SL/TP, pesymizm w tej samej M1)
  stats.ts                     statystyki, podziały, raport kalibracji, strojenie/sprawdzian, zestawy parametrów
  briefing.ts                  briefing dnia + „Kopiuj jako tekst”
  journalLink.ts               sygnał → wpis dziennika (transakcja) i z powrotem
  schema.ts                    zod: settings.scanner, rekordy signals/replays/biases/events/missed
  defaults.ts                  wartości domyślne ze specyfikacji (okna, progi, wagi, korelacje, lista startowa)
src/shared/scanner/import/     csv z TradingView (reużycie shared/calc/ohlc.ts), forexFactory (parser kalendarza)
src/main/scanner/
  eodhd/ws.ts                  klient WebSocket: autoryzacja, subscribe, wznawianie, wykrywanie ciszy, budżet symboli
  eodhd/rest.ts                intraday 1m, eod, listy symboli; kolejka, limit tempa, licznik wywołań, cache
  store/                       pliki binarne M1, pliki H1, indeks pokrycia, luki, kompakcja
  m1.ts                        M1Builder (bid/mid, timer minuty)
  backfill.ts                  uzupełnianie luk, pierwsze pobranie (etapami), harmonogram ponowień
  host.ts                      uruchamianie wątków live/replay, protokół wiadomości
  worker.ts                    wątek: EngineHost + Aggregator (?nodeWorker)
  alerts.ts                    reguły alertów (1 na etap), Notification, dźwięk (polecenie do renderera), wyciszenia
  tray.ts                      ikona w zasobniku, „zbieraj w tle”, zamknięcie do zasobnika
  apiKey.ts                    safeStorage (DPAPI) → userData/scanner/key.bin, maskowanie w logach
  calendar.ts                  pobranie i cache kalendarza, dni HIN
  ipc.ts                       handlery scanner:* i push scanner:event
src/renderer/features/scanner/
  ScannerPage.tsx              zakładka z pod-widokami: Pulpit | Sygnały | Wykres | Bias | Briefing | Replay | Statystyki
  Dashboard.tsx, Tile.tsx      siatka 2×2…4×4, mini-wykresy
  SignalList.tsx, SetupCard.tsx, BiasPanel.tsx, Briefing.tsx, ReplayPage.tsx, StatsPage.tsx, CalibrationReport.tsx
  chart/                       CandleChart (lightweight-charts), prymitywy: strefy, poziomy, tła okien, znaczniki
  StatusBar.tsx                zegar NY, sesja, odliczanie, WS, opóźnienie, limity, najbliższe dane
  settings/                    zakładka Ustawienia → Skaner: instrumenty, okna, detektory, wagi, alerty, klucz, kolory
src/renderer/store/scanner.ts  stan: status, kafelki, sygnały, obiekty per symbol/interwał, bias, replay, filtry
src/renderer/lib/sound.ts      dźwięki alertów (HTML Audio, pliki w resources)
```

### 2.5 Kontrakt IPC (rozszerzenie `shared/api.ts`)

Wywołania (`invoke`): `scanner:start`, `scanner:stop`, `scanner:status`, `scanner:series(symbol, interval, from, to)`,
`scanner:objects(symbol, interval)`, `scanner:signals(filter)`, `scanner:signal(id)`, `scanner:rate(id, rating)`,
`scanner:reportMissed(report)`, `scanner:setBiasOverride(day, symbol, override)`, `scanner:setBondBias`,
`scanner:briefing(day)`, `scanner:apiKey {set, test, clear, state}`, `scanner:symbols:search(q)`,
`scanner:importCsv(symbol, file)`, `scanner:calendar {refresh, list, addManual, edit}`, `scanner:alerts {prefs, mute}`,
`scanner:replay {start, pause, step, speed, stop, list, open, delete}`, `scanner:stats(query)`,
`scanner:paramSets {save, apply, compare}`, `scanner:toJournal(signalId)`, `scanner:cache {usage, clear}`.

Zdarzenia (push `scanner:event`): `status` (WS, opóźnienie, limity, budżet), `tiles` (zbiorczo), `candle`
(zamknięta świeca interwału), `objects` (zmiany obiektów), `signal` (zmiana etapu), `bias`, `alert`, `replay`.

## 3. Technologie i uzasadnienie

| Potrzeba | Wybór | Dlaczego tak, a nie inaczej |
| --- | --- | --- |
| WebSocket w main | Globalny `WebSocket` Node (Electron 44 = Node ≥ 22) | Zero zależności. Zapas: pakiet `ws` (czysty JS, bundlowany jak reszta). Sprawdzone w fazie 1 **[założenie]** |
| REST | `net.fetch` jak NBP i aktualizacje (`main/fx/nbp.ts`) | Ten sam wzorzec, honoruje proxy systemowe. Limiter: ≤ 4 zapytania/s i ≤ 2 równoległe, licznik dzienny z resetem o północy GMT, zapis zużycia w `config.json` |
| Magazyn świec | Własne pliki binarne (sekcja 4.1) | Bez natywnych modułów (`better-sqlite3` odpada). `sql.js` (wasm) trzyma bazę w pamięci – za dużo dla milionów świec. `node:sqlite` wbudowany w Node nie jest pewny w Electronie, a SQL nie jest potrzebny: tylko dopisywanie i odczyt zakresów |
| Czas | luxon (`America/New_York`) + indeks minut UTC | Już w dzienniku; DST poprawnie; indeks minut = szybkie porównania |
| Silnik | czysty TS w `shared`, wątki `?nodeWorker` | Jak OCR; testy w Vitest bez Electrona; replay nie blokuje live |
| Wykresy | lightweight-charts 5.2 + własne prymitywy serii/panelu | Jest w dzienniku; canvas, 16 wykresów bez problemu; prymitywy rysują prostokąty, linie z etykietami, tła okien |
| Stan UI | zustand (selektory prymitywne, zgodnie z konwencją) | Jak w dzienniku |
| Schematy | zod 4, `looseObject`, pola addytywne | Jak w dzienniku; nieznane pola zachowane |
| Powiadomienia | Electron `Notification` | Wbudowane; klik → karta setupu. Uwaga: portable bez skrótu w menu Start może nie pokazać „toastów” – sprawdza użytkownik w fazie 5; zapas: pasek alertu w oknie + miganie ikony w pasku zadań |
| Dźwięk | HTML Audio w rendererze (pliki `.ogg` w `resources/`), CSP `media-src 'self'` | Prosty, osobny dźwięk dla A. Gdy okno zamknięte do zasobnika, dźwięk gra ukryte okno (okno jest ukryte, nie zniszczone) |
| Zasobnik | Electron `Tray` | Zbieranie ticków w tle (sekcja 7, wariant B) |
| Klucz API | `safeStorage.encryptString` (DPAPI na Windows) → `userData/scanner/key.bin` | Wymóg 4.6; w logach `***` |
| Kalendarz | parser JSON Forex Factory w `shared` | Sekcja 9 |
| Eksport | CSV przez istniejący `shared/export/csv.ts` (styl), XLSX bez potrzeby | Statystyki do CSV |
| Testy | Vitest (unit, bez sieci; nagrane odpowiedzi EODHD jako fixture), Playwright E2E z lokalnym serwerem WS/REST (`ICTJ_EODHD_URL`, jak `ICTJ_NBP_URL`) | Deterministycznie, bez klucza w CI |

## 4. Dane

### 4.1 Cache świec (per komputer: `userData/scanner/`)

```
userData/scanner/
  key.bin                        klucz API (DPAPI)
  usage.json                     licznik wywołań REST (dzień GMT), ostatnie błędy
  calendar.json                  cache kalendarza (sekcja 9)
  candles/<SYMBOL>/
    index.json                   pokrycie: [{from, to, source: 'rest'|'stream'|'csv'}], parametry (bid/mid), kontrola
    m1/RRRR-MM.bin               M1 miesiąca: nagłówek 16 B + rekordy 36 B (int32 minuta UTC, 4 × float64 OHLC)
    h1.bin                       H1 złożone z M1 (cała głębokość), ten sam format
```

- Rekordy posortowane; nowe minuty dopisywane na koniec; wstawienie wstecz (backfill) = atomowa przebudowa pliku
  miesiąca (`.tmp` → rename, jak w dzienniku). Float64 = bez utraty precyzji dla złota i JPY.
- Rozmiar: 1 symbol-miesiąc M1 ≈ 1,6 MB; 17 symboli × 13 miesięcy ≈ 350 MB; H1 pomijalne. Zużycie pokazane w ustawieniach,
  przycisk „Wyczyść cache” (odtwarzalny).
- **Pokrycie, nie luki, jest zapisane.** Luka = odcinek godzin rynku (nd 17:00 NY – pt 17:00 NY) poza pokryciem.
  Strumień rozszerza pokrycie wszystkich subskrybowanych symboli, dopóki w ciągu 90 s przyszedł jakikolwiek tick
  (cisza całego strumienia = koniec pokrycia; cisza jednego symbolu przy żywym strumieniu = brak ticków, nie luka).
  REST rozszerza pokrycie o zakres, który faktycznie zwrócił. Minuta bez świecy wewnątrz pokrycia = rynek nie tickował,
  to nie błąd. Dni wolne: brak świec wewnątrz pokrycia, więc nic do oznaczania.
- W pamięci wątku live: M1 z ostatnich 14 dni (M5/M15, sesje, okna), H1 z całej głębokości (H4/D/W, IPDA, dealing range).
  Start z cache: ≈ 17 × (14 × 1440 + 9 600) rekordów, poniżej 2 s.
- Głębokość pierwszego pobrania **[odstępstwo od „1h z 3 lat”]**: 1m w trzech etapach: 14 dni (skaner rusza) →
  120 dni (replay, IPDA) → 400 dni (W, D, roczne poziomy); składniki indeksów 120 dni. Dalsza historia na życzenie
  (ustawienie „głębokość”, 120 dni = 5 wywołań... 400 dni = 20 wywołań REST na symbol). Powód: REST 1h jest innym
  źródłem i nie ma go dla złota.

### 4.2 Agregacja (`shared/scanner/aggregate.ts`)

- Klucz świecy = indeks minut UTC; interwał X zamyka się, gdy przyjdzie pierwsza M1 z następnego kubełka **albo** zegar
  silnika minie koniec kubełka (zegar = ostatnia M1 dowolnego symbolu + 2 s w live; w replay czas feedera).
- M5/M15/H1: kubełki po czasie UTC (pokrywają się z NY, bo DST przesuwa całe godziny). H4: 17, 21, 01, 05, 09, 13 NY
  (granice liczone przez luxon w NY, więc w UTC przesuwają się przy DST). D: 17:00 NY → 17:00 NY, data = data NY końca
  doby. W: niedziela 17:00 NY → piątek 17:00 NY. Sesje: Asia 20:00–00:00, London 02:00–05:00, NY AM 07:00–10:00 NY.
- Poziomy otwarcia: midnight open (pierwsza M1 ≥ 00:00 NY), 08:30 NY, otwarcie tygodnia; NDOG = zamknięcie 17:00 →
  pierwsza M1 od 18:00 NY (uwaga: różnica wobec TradingView do kilku pipsów, patrz rozpoznanie 3.7 – na karcie
  i w definicjach), NWOG = piątek 17:00 → niedziela otwarcie.
- Testy: granica 17:00 NY, zmiana czasu w USA (marzec i listopad), tygodnie z rozjazdem DST USA/Europa, otwarcie
  niedzielne, luka w M1 wewnątrz H1 (świeca H1 powstaje z tego, co jest, i dostaje flagę `incomplete`).

### 4.3 Folder dziennika – nowe kolekcje (synchronizowane między komputerami)

```
signals/RRRR/RRRR-MM-DD_PARA_ULID.json   sygnał z trybu live (data = doba handlowa NY), z historią etapów i oceną użytkownika
replays/ULID.json                         przebieg replay: parametry, zestaw, instrumenty, zakres, sygnały (z ocenami), wynik
biases/RRRR/RRRR-MM-DD.json               nadpisania biasu i DOL per instrument na dobę handlową
events/ULID.json                          ręczne wydarzenia makro (automatyczne są w cache per komputer)
missed/RRRR/RRRR-MM-DD_PARA_ULID.json     zgłoszenia pominiętych setupów ze stanem detektorów
journal.json → settings.scanner           instrumenty, okna, parametry, wagi, korelacje, alerty, newsy, kolory, zestawy parametrów
```

- Mechanika jak dla `forecasts`/`drills` z 1.3–1.4: wpis w `COLLECTIONS` i `CANONICAL` (`shared/paths.ts`), schemat zod,
  migracja no-op, kopie dzienne (`backup.ts` filtruje po `COLLECTIONS`), historia `.history/`, scalanie trójstronne,
  konflikty chmury – wszystko dziedziczone z `DataStore`. **`SCHEMA_VERSION` zostaje 1.**
- Zgodność wstecz: dziennik 1.7.x **ignoruje** nieznane foldery najwyższego poziomu (`kindOfDir` → null), więc stare
  komputery nie pokażą błędów; jedynie ich kopie dzienne nie obejmą kolekcji skanera do czasu aktualizacji.
- Sygnały z replay nie trafiają do `signals/` (jeden przebieg może dać tysiące), tylko do rekordu przebiegu.
  Przebieg > 5 MB jest dzielony na części (`replays/ULID.json` + `replays/ULID-part2.json`) **[założenie]**.
- Konto do wielkości pozycji: istniejące `settings.risk` (saldo, waluta PLN, ryzyko %, krok lota) – skaner nie dubluje.

### 4.4 Rekordy (zarys schematów, `shared/scanner/schema.ts`)

- **Signal:** `id, schemaVersion, createdAt, updatedAt, symbol, direction, models[], intervals[], tradingDay, windowId,
  stage, stageHistory[{stage, at, reason}], sweep{kind, level, at, rank, interval}, mss{at, level, displacement},
  zone{kind: fvg|ob|breaker|ote, interval, from, to, ce}, entry{edge, ce}, stop{candidateA, candidateB, chosen, pips,
  flags[]}, targets{tp1{level, pool, margin}, tp2}, rr{edge, ce}, score{total, grade, parts{…}, counterBias},
  flags[], bias{direction, confidence, source}, intermarket{ok, missing, details}, news{hinDay, nextAt},
  invalidation{price, time}, outcome{kind, rEdge, rCe, mfeR, maeR, at}, rating{verdict, reasonIds[], note, at},
  tradeId, replayRunId, incompleteData, paramSetId`.
- **Replay run:** `id, name, instruments[], from, to, speedLog?, paramSet{…}, priceMode, spreads{symbol: pips},
  signals: Signal[], summary{…}, createdAt`.
- **Bias day:** `date, overrides{symbol: {direction, dol, note, setAt, expiresAt}}, approved{symbol: at}`.
  Bias obligacji „do odwołania” w `settings.scanner.intermarket.bonds`.
- **Event:** `id, at (UTC), currency, title, impact, source: manual|ff, note`.
- **Missed report:** `id, symbol, at, direction, model, note, detectorState{…}`.
- **settings.scanner:** `instruments[{id, symbol, eodhdSymbol, enabled, pipSize, priceDecimals, contractSize, maxStopPips
  | null (auto), tpMarginPips, fvgMin{M5, M15, H1, H4, D}, eqTolerance{M15, H1, H4}, replaySpreadPips, currencies}],
  windows[], silverBullet[], sessions{}, detectors{swingN, sweepMinPips, sweepK, displacementM, displacementLookback,
  obInvalidate…}, models{m1MaxBarsM5: 12, sbMinPoolPips: 15, turtleAggressive: false}, score{weights, thresholds{A: 80,
  B: 60}, hinPenalty: 15, counterBiasPenalty}, alerts{minGrade: 'B', stages: ['ready'], distinctA: true}, news{currencies:
  ['USD','EUR'], keywords[], before: 15, after: 15}, correlations[], intermarket{require: true, bonds{ZB, FGBL}},
  price: 'bid', colors{bearish: '#2ebd85'?, bullish: burgund}, depthDays, paramSets[], ratingReasons[], gridInterval`.
  Lista startowa i wartości domyślne w `defaults.ts`, zasiewane przy pierwszym otwarciu zakładki.

### 4.5 Per komputer (`config.json` → `scanner`)

`soundEnabled, notificationsEnabled, muteUntil, mutedSymbols[], closeToTray, collectInBackground, apiKeyPresent,
restUsage{date, calls}`. Przełączniki alertów są per komputer **[założenie]**: komputer przy biurku i laptop mogą
mieć inne potrzeby; do potwierdzenia (pytanie 10).

## 5. Silnik ICT – zarys implementacji

### 5.1 Detektory

- Interfejs: `createDetector(params) → { onCandle(candle, ctx), snapshot(): Objects }`; wersja wsadowa `detectX(candles,
  params)` dla testów. Każdy obiekt ma `id` (deterministyczny: symbol + interwał + czas powstania + typ), `createdAt`
  (czas świecy, która go potwierdziła), poziomy, stan (`open / touched / ceReached / filled / inverted`, dla OB
  `valid / invalidated`), `incomplete` (gdy w oknie danych była luka).
- Przyrostowo: swing potwierdza się po N świecach z prawej (N = 1), więc zdarzenie „nowy swing” wychodzi z opóźnieniem
  jednej świecy – to jest jedyne dopuszczalne „czekanie na potwierdzenie” w teście braku zaglądania w przyszłość.
- Rejestr poziomów (`levels.ts`): pule (PDH/PDL, PWH/PWL, PMH/PML, high/low sesji, EQH/EQL, niezebrane swingi H1/H4/D,
  ekstrema 20/40/60 dni) z rangą = liczba interwałów, na których poziom występuje w tolerancji EQH/EQL; stan
  nietknięta/zebrana z czasem. Hierarchia pozostałych według ICT (konfigurowalne wagi w ocenie).
- Rozszerzenia (mitigation, rejection, BPR, VI/LV, PO3/Judas) – ten sam interfejs, tylko do oceny i warstw.

### 5.2 Modele, poziomy, ocena, cykl życia

- Modele działają osobno na M5 i M15, korzystają ze wspólnego rejestru poziomów; sweep musi być w oknie (okna użytkownika
  02:00–04:40 i 07:00–10:00 NY; klasyczne SB tylko dla modelu 3).
- Wejście: strefa od–do + dwa poziomy (krawędź bliższa cenie, CE / mean threshold); SL: kandydat A (ekstremum sweepu +
  bufor 1 p + spread), B (za strefą), maksimum 20 p (złoto/ropa: ułamek ADR20, sekcja 12 pkt 1), kontrole „SL przy
  płynności” (≤ 2 p od puli) i „SL przed PD array”; TP1 = pierwsza nietknięta pula − margines 4 p, TP2 = następna/DOL,
  R:R ≥ 2 do TP1 na którymś z poziomów; przeszkody = przeciwne PD arrays H1+ między wejściem a TP1.
- Ocena: tabela 8.4 (100 pkt), kontra bias = flaga + kara + brak alertu; brak spójności intermarket = brak A + brak
  alertu (przełączalne); „obligacje nieustawione” = brak A, alert działa. Rozbicie punktów zawsze zapisane w sygnale.
- Cykl życia: obserwacja → uzbrojony → gotowy → aktywny → zakończony (TP1/TP2/SL/wygasł/unieważniony/odrzucony),
  przeliczenie oceny przy każdej zmianie etapu; scalanie M5+M15 w jeden sygnał (ten sam symbol, kierunek, pula sweepu,
  strefy nachodzące); jeden alert na etap.

### 5.3 Bias, indeksy, SMT, obligacje, newsy

- Bias W/D/H4/H1: struktura (ostatni MSS/BOS z displacementem), order flow (respektowanie FVG), premium/discount,
  najbliższy cel po obu stronach → kierunek, pewność, powody; sprzeczność D vs H4 → pewność niska i komunikat;
  struktura wygrywa z celem. Nadpisanie użytkownika ma pierwszeństwo do końca doby handlowej (rekord `biases/`).
- DXY/EURX: wzory ICE ze specyfikacji; weryfikacja stałych w fazie 1 przez porównanie zamknięć dziennych syntetycznych
  z `DXY.INDX` / `EXY.INDX` (EODHD) i z odczytem użytkownika z TradingView; indeksy mają własne świece i silniki.
- SMT: okno ±3 świece na M15 i H1 według mapy korelacji (edytowalnej); „ta sama ekspozycja” – flaga na obu kartach.
- Obligacje: sekcja 10. Newsy: sekcja 9.

### 5.4 Wielkość pozycji

Reużycie `shared/calc/position.ts` (loty = kapitał × % / (SL pips × kontrakt × pipSize × kurs kwotowana→konto), w dół
do kroku lota). Kurs ze strumienia: waluta kwotowana → PLN przez USD (`USDPLN` + para z USD: GBP→PLN = GBPUSD × USDPLN,
CHF→PLN = USDPLN / USDCHF…), więc **bez dodatkowych symboli** poza USDPLN. Brak kursu → karta mówi „brak kursu”.

## 6. Fazy (każda kończy się commitem, przystankiem i instrukcją sprawdzenia dla użytkownika)

Model i effort z tabeli specyfikacji (kolumna zależna od resetu limitu w niedzielę 11.10, 18:00 PL).

**Szacowany czas czystej pracy Claude'a** (na prośbę użytkownika – przed każdą fazą podaję oszacowanie zaktualizowane
o to, co wyszło w poprzedniej). Liczony jest czas samej pracy w sesji: pisanie kodu, testy, poprawki, czekanie na CI
(ok. 12–15 min na przebieg). Nie wliczam przerw na limity użycia i oczekiwania na odpowiedzi użytkownika. Effort xhigh
wydłuża pracę o ok. 30–50% względem high.

| Faza | Szacunek | Co najbardziej wpływa na czas |
| --- | --- | --- |
| 1. Dane i magazyn świec | 5–8 h (+ ok. 0,5 h pomiarów po otwarciu rynku) | Klient WS z odpornością, magazyn binarny z pokryciem, agregacja z DST, E2E z lokalnym serwerem |
| 2. Silnik ICT | 6–10 h | Liczba detektorów, test „przyrostowy = wsadowy” i brak zaglądania w przyszłość dla każdego, warstwy wykresu |
| 3. Modele, ocena, cykl życia | 7–11 h (po zmianie paradygmatu) | Top-down D/H4/H1/M15, kombinacje warunków modeli, scalanie H1/M15, bias, SMT, intermarket |
| 4. Interfejs, briefing, oceny | 6–10 h | Dużo ekranów, wydajność 16 wykresów, „Wyślij do dziennika” |
| 5. Alerty, kalkulator, newsy | 3–5 h | Kalendarz Forex Factory, reguły alertów, okno publikacji |
| 6. Replay, statystyki, kalibracja | 5–8 h | Determinizm, symulacja wyniku, raport kalibracji, zestawy parametrów |
| 7. Build, test całości, raport | 2–4 h | Przegląd końcowy (workflow agentów), dokumentacja, poprawki po przeglądzie |
| **Razem** | **ok. 34–56 h** | Bez poprawek po Twoich sprawdzeniach (zwykle +10–20%) |

**Aktualizacja po fazie 1 (11.10.2026):** faza 1 zajęła ok. 1 h czystej pracy (z CI), przy szacunku 5–8 h – pierwotne
szacunki były ok. 5× za wysokie. Nowe: faza 2 – 2–4 h, faza 3 – 2–4 h, faza 4 – 2–3 h, faza 5 – 1–2 h, faza 6 –
1,5–3 h, faza 7 – 1–2 h; **razem ok. 10–18 h**. Fazy 2–3 mają więcej logiki do strojenia z użytkownikiem, więc rozrzut
jest większy.

### Faza 1 – warstwa danych i magazyn świec (Opus 5.5, xhigh / high)

Zakres: klucz API (ustawienia, DPAPI), klient WS (autoryzacja, subscribe jedną wiadomością, wznawianie z rosnącym
odstępem 1–60 s, cisza, budżet symboli, `Symbols limit reached`), REST (limiter, licznik, cache), M1Builder (bid/mid),
magazyn + pokrycie + luki, agregacja wszystkich interwałów, backfill etapowy, zasobnik (opcja), import CSV z TradingView,
zakładka „Skaner” z paskiem stanu i **surowym wykresem szczegółowym** (świece, interwały, luki zaznaczone) oraz
Ustawienia → Skaner (instrumenty z wyszukiwarką symboli EODHD, klucz, bid/mid, głębokość, cache). Weryfikacja stałych
DXY/EURX. Domknięcie odroczonych testów 4.1.1 / 4.1.5 / bid-mid po otwarciu rynku i decyzja wariantu z sekcji 7.
Testy: agregacja (DST, 17:00, tydzień, otwarcie niedzielne), magazyn (append, przebudowa, pokrycie, luki), M1Builder
(spóźnione ticki, minuta bez ticków), parser odpowiedzi EODHD na nagranych fixture, E2E z lokalnym serwerem WS/REST.
Odbiór: exe z CI; użytkownik widzi świece zgodne z TradingView, luki oznaczone, status WS, zużycie limitów.

### Faza 2 – silnik ICT z testami (Fable 5.1, xhigh / high)

Zakres: wszystkie detektory rdzenia + rozszerzenia, rejestr poziomów z rangą, dealing range, OTE, poziomy otwarcia,
okna czasowe; warstwy na wykresie szczegółowym (FVG z etykietami „D/240/60 FVG”, OB/breaker, pule z etykietami, sweepy,
MSS/BOS, dealing range, OTE, poziomy otwarcia, tła okien) – żeby użytkownik mógł porównać detektory ze swoim okiem.
Testy: każdy detektor na ręcznych sekwencjach (pozytywny, negatywny, brzegowy), przyrostowy = wsadowy, brak zaglądania
w przyszłość (wynik na 1..n niezmienny po n+1), `definicje.md` w wersji zaimplementowanej.
Odbiór: użytkownik ogląda 2–3 dni na wykresie i mówi, co detektor widzi inaczej niż on (lista poprawek do fazy 3).

### Faza 3 – modele wejścia, ocena, cykl życia (Fable 5.1, xhigh / high; po resecie xhigh tylko za zgodą)

Zakres: 4 modele na M5/M15, scalanie, poziomy setupu (wejście, SL, TP), ocena z rozbiciem, cykl życia, bias hybrydowy
z panelem (prosty), DXY/EURX syntetyczne jako instrumenty, SMT, ekspozycja, spójność intermarket (bias obligacji D
automatycznie, H4 ręcznie), zapis sygnałów do `signals/`, podstawowa lista sygnałów i karta setupu (tekstowa).
Testy: modele na sekwencjach (w tym „setup poza oknem nie jest sygnałem”, wygaśnięcie z końcem okna, SL powyżej
maksimum → odrzucony, R:R < 2 → odrzucony), ocena (sumy, progi, kary), cykl życia, scalanie M5/M15, determinizm.
Odbiór: użytkownik sprawdza sygnały z ostatnich dni (lista + wykres), test złoty na wskazanych dniach (jeśli już są).

### Faza 4 – interfejs, briefing, oceny (Opus 5.5, medium)

Zakres: pulpit 2×2…4×4 z mini-wykresami i kafelkami (symbol, cena, bias, okno, HIN, niepełne dane, ocena/etap,
podświetlenie), lista sygnałów z filtrami i sortowaniem, pełna karta setupu, wykres szczegółowy z aktywnym setupem,
panel bias (tabela instrument × W/D/H4/H1, zatwierdzenie/nadpisanie, DOL, obligacje), briefing dnia + „Kopiuj jako
tekst”, oceny (dobry / zły / nie wziąłbym + powody + notatka), „zgłoś pominięty setup”, „Wyślij do dziennika”
(wpis + screen wykresu przez pipeline WebP, link w obie strony: pole `trade.scannerSignalId` addytywne), skróty
klawiszowe, ściąga, paleta poleceń. E2E: nawigacja, filtry, karta, wysłanie do dziennika.

### Faza 5 – alerty, kalkulator pozycji, newsy (Opus 5.5, medium)

Zakres: przełączniki dźwięk/powiadomienia na pasku stanu, próg oceny, etapy, wyciszenia (per instrument, „1 h”),
osobny dźwięk dla A, jeden alert na etap, treść + klik → karta; kalendarz (sekcja 9): pobieranie, dni HIN, okno
publikacji ze wstrzymaniem alertów i odliczaniem, cele na dane na wykresie, pasek „dziś i jutro”, ręczne wydarzenia;
wielkość pozycji na karcie (ryzyko w PLN, loty, wartość pipsa). Testy: reguły alertów, okno publikacji, parser kalendarza.
Odbiór: użytkownik sprawdza na Windows powiadomienia (portable i zainstalowana), dźwięki, kalendarz.

### Faza 6 – replay, statystyki, kalibracja (Opus 5.5, high)

Zakres: replay (instrumenty, zakres, prędkość, pauza, krok; pulpit/lista/karty jak live; alerty domyślnie wyłączone;
nadpisania biasu z danego dnia odtwarzane), symulacja wyniku (krawędź i CE osobno, SL i TP1 w tej samej M1 = SL,
spread stały per instrument), statystyki z podziałami i „czy ocena działa”, realne vs symulowane dla sygnałów
powiązanych z wpisem, eksport CSV, uczciwość (napis stały, „za mała próba” < 30), raport kalibracji, okres strojenia /
sprawdzianu (domyślnie 2/3 : 1/3), zestawy parametrów i porównanie. Test determinizmu (dwa przebiegi = identyczne)
i zgodności live/replay (dzień zapisany na żywo). Raport fazy: liczba alertów dziennie na domyślnych progach
vs cel 4–8, propozycja korekty.

### Faza 7 – build, test całości, raport (Opus 5.5, high)

Zakres: pełny `npm test`, `typecheck`, E2E, build exe z CI, przegląd końcowy jako workflow (agenci: brak zaglądania
w przyszłość, zgodność ze specyfikacją, bezpieczeństwo klucza), `docs/skaner/README.md` (dla użytkownika),
`definicje.md`, `decyzje.md`, raport końcowy z każdym odstępstwem, CHANGELOG, pull request. Bez tagu i wydania.

## 7. Luka po uruchomieniu w środku sesji (decyzja po teście 4.1.5 w fazie 1)

- **Wariant A – REST świeży (opóźnienie rzędu minut):** przy starcie i po wznowieniu `Backfill` pobiera brakujący
  zakres (od końca pokrycia − 5 min do teraz), luka znika w kilka sekund; detektory ruszają z pełną sesją Asia/London.
- **Wariant B – REST nieświeży (godziny):** aplikacja zminimalizowana do zasobnika zbiera ticki od otwarcia rynku
  (opcje: „zamykaj do zasobnika”, „uruchamiaj z systemem” przez `app.setLoginItemSettings`, „zbieraj w tle”); komputer
  wyłączony w nocy = luka do czasu, aż REST ją uzupełni (następnego dnia). W trakcie dnia skaner pracuje z flagą
  „niepełne dane” na kafelku; sygnały mają `incompleteData`, alerty działają (do decyzji: czy wstrzymać alerty przy
  niepełnej sesji – pytanie 11). Osobny lekki proces zbierający **nie jest planowany** (dubluje aplikację; zasobnik
  daje to samo) **[założenie]**.
- **Zawsze:** luki widoczne, ponawianie REST co 15 min, ręczny import CSV z TradingView dla dowolnego symbolu i zakresu.

## 8. WTI – warianty

| Wariant | Co daje | Koszt |
| --- | --- | --- |
| **A (rekomendowany): live `WTIUSD` + historia od włączenia + import CSV z TradingView** | Sygnały intraday od pierwszego dnia (M5/M15 po kilku godzinach zbierania); HTF (H4/D, IPDA) z CSV z TradingView (OANDA, spójny z wykresami użytkownika; eksport „Export chart data” na D i H1 daje tysiące świec) | Ręczny eksport raz na początku i po dłuższych przerwach; luki przy wyłączonym komputerze do czasu importu |
| B: drugi dostawca historii WTI | Pełna automatyka | Płatna usługa albo dodatkowy klucz; inny feed niż OANDA i EODHD |
| C: rezygnacja z WTI | Prostota | Brak instrumentu z listy |

Zanim wybierzemy A: w fazie 1 sprawdzam w sesji, czy `WTIUSD` faktycznie streamuje (migawka była z piątku 16:56 NY,
`ppms: true`) i w jakich godzinach (ropa CME: 18:00–17:00 NY z przerwą).

## 9. Kalendarz makro – warianty

| Wariant | Co daje | Uwagi |
| --- | --- | --- |
| **A (rekomendowany): plik tygodniowy Forex Factory** (`nfs.faireconomy.media/ff_calendar_thisweek.json`, także `nextweek`) | Wydarzenia z walutą, godziną i polem ważności (High/Medium/Low), bez klucza, dozwolony do użytku osobistego przy pobieraniu nie częściej niż co godzinę | Pobieranie co 2 h przez main, cache per komputer, lista „HIN” = ważność High dla walut z ustawień + słowa kluczowe (NFP, CPI, PPI, FOMC, ECB, GDP, Retail Sales, PMI, ISM, EIA) |
| B: podniesienie planu EODHD do „All-In-One” (ok. 100 USD/mies.) | Endpoint `/economic-events`; w dokumentacji brak pola ważności, więc klasyfikacja i tak po nazwach | Wymaga płatności – zatrzymanie według sekcji 3 specyfikacji |
| C: tylko ręczne wydarzenia | Bez sieci | Użytkownik wpisuje tydzień z wyprzedzeniem |

Niezależnie od wariantu: ręczne dodawanie i edycja, godziny przeliczane do NY, pasek „dziś i jutro”.

## 10. Obligacje (ZB, FGBL)

- Brak intraday w EODHD. Plan: **bias D liczony automatycznie** tymi samymi detektorami na seriach dziennych:
  USD = rentowność 30Y (`TYX.INDX`, 1h w godzinach USA + dziennie; cena ZB ≈ odwrotność, więc „ZB w dół” = TYX w górę),
  EUR = Bund (`FGBLZ26.US`, dziennie, z rolowaniem kontraktu co kwartał: lista symboli `FGBL<miesiąc><rok>.US`).
  **Bias H4 ustawia użytkownik** w panelu bias (rośnie / spada / neutralny, do odwołania) z przypomnieniem na starcie
  doby handlowej, jak przewiduje 7.4. Brak ustawienia = flaga „obligacje nieustawione” (bez A, alert działa).
- Dla pewności, że TYX ↔ ZB to dobre przybliżenie, pierwszy briefing pokaże obok siebie bias z TYX i ustawienie ręczne.

## 11. Ryzyka

| Ryzyko | Skutek | Zabezpieczenie |
| --- | --- | --- |
| REST 1m nieświeży w sesji (4.1.5) | Brak sesji Asia/London po włączeniu rano → brak sweepów sesyjnych | Sekcja 7, wariant B; luki jawne; import CSV |
| Strumień FX milczy dla części symboli w sesji (4.1.1 odroczone) | Instrument bez live | Wykrywanie ciszy per symbol przy żywym strumieniu, komunikat na kafelku; wariant: inny symbol EODHD |
| WebSocket z procesu głównego przez proxy/firewall użytkownika | Brak live | `ws` z obsługą proxy jako zapas; status i diagnostyka w pasku |
| 50 symboli na klucz, dwa komputery naraz | Druga subskrypcja odrzucona w całości | Budżet liczony przed wysłaniem, komunikat „limit symboli: zamknij skaner na drugim komputerze”, tryb „tylko instrumenty” (bez składników indeksów) |
| Powiadomienia Windows w wersji portable | Toast się nie pokazuje | Sprawdzenie w fazie 5; zapas: pasek alertu w oknie + miganie ikony; instalator (NSIS) ma skrót w menu Start |
| Pierwsze pobranie historii (17 symboli × 400 dni ≈ 1 GB JSON) | Długi start pierwszego dnia, zużycie limitu (≈ 340 wywołań z 100 000) | Etapowo (14 → 120 → 400 dni) w tle z paskiem postępu; skaner działa już po pierwszym etapie |
| Definicje ICT są dyskrecjonalne | Detektor widzi inaczej niż użytkownik | Warstwy na wykresie od fazy 2, wszystkie progi edytowalne, test złoty, oceny → raport kalibracji |
| Za dużo / za mało alertów | Cel 4–8 dziennie | Raport w fazie 6 i propozycja progów |
| Uśpienie komputera, utrata sieci | Luki, stare pokrycie | `powerMonitor` (resume → wznowienie + backfill), wykrywanie ciszy, ponowienia |
| Rozmiar cache | Setki MB na dysku | Pokazane w ustawieniach, czyszczenie, głębokość do wyboru |
| Wydajność: 16 wykresów + ~25 strumieni | Zacinanie UI | Ticki buforowane (≤ 4 aktualizacje/s), wykresy canvas, przeliczenia w wątkach; test wydajności w fazie 4 |
| Świeca 17:00 NY i NDOG/NWOG różnią się od TradingView o kilka pipsów | Inne poziomy luk otwarcia | Zaznaczone w definicjach i na karcie; opcja „pomiń pierwsze 2 minuty po otwarciu” |

## 12. Pytania do użytkownika (sekcja 15 + własne)

**Odpowiedź użytkownika (11.10.2026): wszystkie wartości domyślne poniżej; gałąź – zostajemy na
`claude/quirky-bohr-o95s2l`.** Pytanie 6 nie ma wartości domyślnej: test złoty czeka na wskazanie dni (najpóźniej
w fazie 3). Zapis w `decyzje.md`.

1. **Pips i kontrakt dla XAUUSD i WTI, maksymalny SL.** Domyślnie: XAUUSD pips 0,1 USD (2 miejsca po przecinku
   w cenie), kontrakt 100 uncji; WTI pips 0,01, 1 lot = 1000 baryłek (jak preset dziennika). Wyliczony max SL złota:
   20 p EURUSD = 32% ADR20 EURUSD (62 p) → **32% × ADR20 XAUUSD (80,5 USD) ≈ 26 USD/oz** (≈ 260 pipsów po 0,1).
   WTI: po zebraniu 20 dni danych; tymczasowo 2% ceny.
2. **Kapitał, ryzyko na transakcję, krok lota** – skaner użyje wartości z Ustawienia → Ryzyko w dzienniku
   (`settings.risk`). Czy są aktualne?
3. **Bid czy mid** – domyślnie bid (wstępny wynik porównania); ostateczne po otwarciu rynku.
4. **WTI** – wariant A (sekcja 8)? **Kalendarz** – wariant A, Forex Factory (sekcja 9)?
5. **Zbieranie w tle** – jeśli REST okaże się nieświeży: zamykanie do zasobnika i start z systemem (sekcja 7, wariant B)?
6. **Test złoty** – 3–5 dni (data, instrument, kierunek, orientacyjne poziomy), najlepiej z ostatnich 120 dni.
7. **Powody ocen** – domyślna lista: zły bias, słaby displacement, mało istotna płynność, za późno w oknie, przeszkoda
   przed TP, SL za szeroki, za blisko newsów, zła strefa wejścia, inne. Co dodać/usunąć?
8. **Gałąź** – zostać na `claude/quirky-bohr-o95s2l` (jest tu już krok 1, CI buduje exe) czy założyć `feature/skaner-ict`?
9. **Skrót** – `Ctrl+0` dla zakładki Skaner (Ctrl+1…9 zajęte)?
10. **Przełączniki alertów** per komputer (propozycja) czy wspólne dla obu komputerów?
11. **Alerty przy niepełnej sesji** (luka w Asia/London po włączeniu rano) – działają z flagą (propozycja) czy wstrzymane?
12. **Głębokość historii** – 400 dni 1m dla instrumentów, 120 dni dla składników indeksów (propozycja)?
13. **Obligacje** – zgoda na rentowność 30Y (TYX) jako zamiennik ceny ZB (kierunek odwrotny) i Bund tylko dziennie?

## 13. Gałąź, CI, wydanie

- Praca na gałęzi `claude/quirky-bohr-o95s2l` (decyzja użytkownika, zamiast `feature/skaner-ict` ze specyfikacji);
  commit po każdej fazie; `postep.md` aktualizowany z każdym commitem.
- CI już buduje exe dla każdego pusha (artefakt `ICT-Trade-Journal-windows-<sha>`, 14 dni) – przy każdym przystanku
  podam link do przebiegu i artefaktu. Bez zmian w workflow.
- Wersja w `package.json` i `CHANGELOG` podniesione dopiero w fazie 7 (np. `1.8.0`), bez tagu; wydanie robi użytkownik
  po połączeniu zmian.
- Testy w CI nie potrzebują klucza EODHD: unit na nagranych odpowiedziach, E2E na lokalnym serwerze WS/REST.

## 14. Zmiana paradygmatu: top-down D → H4 → H1 → M15 (11.10.2026)

Powód: setupy użytkownika z testu złotego (`test-zloty.md`) to wejścia na H1 (60 FVG) trwające dni, poza oknami
i z SL większym niż w specyfikacji. Użytkownik: „wchodzimy na H1, skaner przeczesuje interwały i struktury D, H4, H1,
M15, a wejście na M15 jest uzasadnione, jeżeli jest bias na wyższych interwałach”. **[odstępstwo od sekcji 6 i 8
specyfikacji – za zgodą użytkownika]**

### 14.1 Role interwałów

| Interwał | Rola |
| --- | --- |
| D, H4 | **Bias** (struktura MSS/BOS z displacementem, order flow, premium/discount, DOL; przy sprzeczności decyduje struktura) |
| H1 | **Główny interwał wejścia**: sweep → displacement z MSS → powrót do 60 FVG / OB / OTE / breaker |
| M15 | **Wejście doprecyzowane**, tylko zgodnie z biasem wyższych interwałów |
| W | Tylko poziomy (PWH/PWL, zakresy IPDA) i kontekst, bez osobnej analizy struktury |
| M5 | Nie używany przez modele (agregacja z M1 i tak go liczy; zostaje do ewentualnego użycia) |

Panel bias i briefing: instrument × D / H4 / H1 / M15 (kierunek, ostatni MSS/BOS, pewność, powody) + wiersz
„zgodność”. Siatka pulpitu domyślnie H1 (przełącznik M15 / H1 / H4).

### 14.2 Wymóg biasu (odpowiedź 1: zgoda)

- Wejście **H1** wymaga zgodnego biasu **D i H4** (zatwierdzonego, nadpisanego przez użytkownika albo wyliczonego
  z wysoką pewnością). Setup H1 przeciw biasowi: widoczny z flagą „kontra”, niższa ocena, **bez alertu**.
- Wejście **M15** wymaga zgodnego **D, H4 i H1**. M15 przeciw biasowi **nie jest sygnałem** (elementy zostają na wykresie).
- Bias neutralny lub niska pewność na D/H4 = brak wymaganego biasu (setup widoczny jak „kontra”, bez alertu).

### 14.3 Okna czasowe (odpowiedź 2: „tylko podczas KZ London i NY”)

- Okna: **London 02:00–04:40** i **NY 07:00–10:00** (czas NY, edytowalne). Klasyczne okna Silver Bullet 10–11 i 14–15
  **odpadają**; model Silver Bullet działa tylko w części okna, która się z nimi pokrywa (03:00–04:00) **[założenie]**.
- **Decyzja użytkownika: w KZ musi być tylko wejście; setup może powstać o dowolnej porze** (H1 i M15).
  - Etap „gotowy” / „aktywny” tylko, gdy cena wchodzi w strefę **w KZ**.
  - Dotknięcie strefy poza KZ nie jest wejściem i nie daje alertu; setup trwa dalej do unieważnienia (14.4), a sygnał
    dostaje znacznik „dotknięty poza KZ” (replay liczy takie przypadki osobno – widać, co ucieka poza oknami)
    **[założenie]**.
  - Test złoty: Z1 (11:00), Z3 (21:00), Z4 (18:00 NY) mają wejście poza KZ – skaner ma je wykryć jako setupy
    uzbrojone z poziomami zbliżonymi do oznaczeń użytkownika, ale bez wejścia; Z2 – wejście w KZ tylko w wariancie
    pon 3.08 09:00 NY.

### 14.4 Ważność setupu H1 (odpowiedź 3: zgoda)

Setup H1 nie wygasa z końcem okna. Kończy się, gdy: FVG zostanie zamknięty po drugiej stronie (świeca H1), cena zamknie
się za ekstremum sweepu / początkiem nogi, cena dojdzie do TP1 bez cofnięcia do strefy, albo zmieni się bias D/H4
(wyliczony lub nadpisany). Setup M15 wygasa z końcem okna, jak w specyfikacji.

### 14.5 Maksymalny SL (odpowiedź 4: „30 pipsów”)

- **FX: 30 pipsów** dla wejść H1 i M15 (zamiast 20). Kandydaci SL A/B i kontrole bez zmian.
- **Złoto: 65 USD** (decyzja użytkownika; skaner ma własny preset XAUUSD: pips 0,1 USD, kontrakt 100 oz, więc
  65 USD = 650 pipsów). Test złoty: SL Z1–Z4 (23,8–62,6 USD) mieszczą się. **Ropa (WTI):** skalowana zmiennością
  (30 p EURUSD ≈ 48% ADR20 → ten sam ułamek ADR20 WTI), tymczasowo 2% ceny do zebrania 20 dni; edytowalne.

### 14.6 Alerty (punkt 5 bez odpowiedzi – przyjęta propozycja)

- H1: alert przy etapie **„uzbrojony”** (jest MSS i strefa – można postawić zlecenie limit) i przy **„gotowy”**
  (cena w strefie). M15: alert przy „gotowy”. Oba tylko dla setupów zgodnych z biasem.
- Cel 4–8 alertów dziennie prawdopodobnie spadnie do ok. 1–4 przy setupach H1; zmierzone w replay (faza 6).

### 14.7 Modele po zmianie

| Model | H1 | M15 |
| --- | --- | --- |
| 1. Sweep → MSS → FVG/OB | tak (MSS w ciągu 12 świec interwału wejścia, parametr) | tak |
| 2. OTE 62–79% | tak | tak |
| 3. Silver Bullet | nie | tylko 03:00–04:00 NY (część KZ London) |
| 4. Turtle soup, breaker | tak | tak |

- Pule do sweepu i celów dla wejść H1: z H1, H4, D (+ W); dla M15: także z M15. TP1/TP2 i min. R:R 2 bez zmian.
- Ocena 8.4: „zgodność z biasem D i H4” zostaje (dla H1 jest jednocześnie warunkiem alertu); wejście w KZ jest
  warunkiem twardym etapu „gotowy” (14.3).
- **Konwergencja PDA – dodatkowe punkty (decyzja użytkownika):** strefa wejścia pokrywa się z innym PD array
  (FVG + OB, FVG z kilku interwałów, OTE + FVG/OB, breaker, BPR, poziom otwarcia). Premia: 2 nakładające się PDA
  = +5, 3 i więcej = +10, ponad 100 punktów tabeli 8.4, wynik obcinany do 100; progi A/B/C bez zmian; wartości
  edytowalne **[założenie co do wielkości premii]**.
- Scalanie: ten sam ruch na H1 i M15 = jeden sygnał z listą interwałów.

### 14.8 Wpływ na fazy

- Faza 1: bez zmian (baza M1, agregacja do M15/H1/H4/D/W).
- Faza 2: te same detektory na D/H4/H1/M15.
- Faza 3: modele i cykl życia według 14.2–14.7; test złoty = Z1–Z4 jako wejścia H1 (z odchyleniami zależnymi od 14.3
  i 14.5). Szacunek 7–11 h.
- Faza 4: panel bias D/H4/H1/M15 z wierszem zgodności, siatka domyślnie H1.
