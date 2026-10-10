# Skaner ICT – rozpoznanie (krok 1)

Stan na sobotę 10.10.2026, ok. 17:00–18:30 czasu NY. Rynek FX był zamknięty (piątek 17:00 NY → niedziela 17:00 NY),
dlatego punkty 1 i 5 testu wykonalności są odroczone (sekcja 4.1 specyfikacji); punkt 7 wykonany na eksporcie z
TradingView od użytkownika (bez ostatecznego bid/mid).

## W skrócie (prostym językiem)

- **Da się zbudować skaner na EODHD.** Klucz działa, plan to płatna subskrypcja z dostępem do strumienia na żywo
  (WebSocket) i historii minutowej. Wszystkie pary z listy startowej, złoto oraz pary potrzebne do DXY/EURX i USDPLN
  istnieją w strumieniu i mają historię minutową (złoto co najmniej od 2023 r.).
- **Ropa WTI:** jest na żywo w strumieniu (`WTIUSD`), ale EODHD nie ma dla niej żadnej historii. Skaner musiałby
  sam zbierać jej świece od chwili włączenia (dni/tygodnie, zanim będą D i H4) – warianty w planie (krok 2).
- **DXY i EURX:** EODHD daje tylko świece dzienne, więc indeksy trzeba liczyć z par walutowych (tak jak przewiduje
  specyfikacja, sekcja 7.2). Wszystkie potrzebne pary są dostępne.
- **Obligacje:** T-Bond (ZB) nie ma; jest rentowność 30-letnich obligacji USA (TYX, świece godzinowe w godzinach
  sesji USA). Bund jest tylko jako świece dzienne kontraktu grudniowego (FGBLZ26). Do H4 pozostaje ręczne ustawienie
  biasu obligacji (specyfikacja to przewiduje).
- **Kalendarz makro z EODHD nie jest dostępny w tym planie** (odpowiedź 403). Trzeba innego źródła – propozycja w planie.
- **Ważne pułapki danych:** (1) EODHD zwraca „świece” także w weekend (płaski szum) – trzeba je odcinać godzinami
  rynku; (2) świece 5-minutowe i godzinowe z EODHD pochodzą z innego źródła niż minutowe i różnią się o ok. 3 pipsy,
  mają też puste i błędne świece – wszystko trzeba składać z minutówek; (3) limit 50 symboli liczy się na cały klucz,
  a za duża subskrypcja jest odrzucana w całości.
- **Ceny zgadzają się z TradingView (OANDA)**: typowo 0,1 pipsa na świecach H1 i na PDH/PDL. Wyjątek to świeca
  o 17:00 NY (otwarcie po przerwie), gdzie różnica sięga kilku pipsów (punkt 3.7).
- **Do zrobienia po otwarciu rynku** (niedziela 17:00 NY = 23:00 w Polsce): strumień FX na żywo, świeżość historii
  minutowej w trakcie sesji, ostateczne rozstrzygnięcie bid czy mid.

## 1. Repozytorium dziennika

Szczegóły są w `CLAUDE.md`; poniżej to, co ma znaczenie dla skanera (wersja 1.7.2).

**Stos technologiczny.** Electron 44 + React 19 + TypeScript 6 (strict) + Vite 7 (`electron-vite` 5) + Tailwind 4,
zustand 5 (stan), zod 4 (schematy = źródło typów), luxon (strefy, DST), ulid, lightweight-charts 5.2 (dziś tylko
wykres equity). **Żadnych natywnych modułów Node**: wszystko bundlowane do `out/`, `app.asar` bez `node_modules`.
To wyklucza `better-sqlite3` i podobne. Magazyn świec trzeba oprzeć na czystym JS/wasm albo na własnym formacie plików.
Testy: Vitest (40 plików `tests/unit`, 10 `tests/fs`), Playwright `_electron` (20 plików `tests/e2e`).

**Struktura kodu.**
- `src/shared`: czyste TS dla obu procesów (schematy, obliczenia, eksport). Tu pasują detektory ICT i agregacja świec,
  testowalne w Vitest bez Electrona.
- `src/main`: jedyny właściciel folderu danych i jedyny proces z siecią (`net.fetch` dla NBP i aktualizacji).
  IPC przez helper `handle(channel, fn)` w `main/index.ts` z logowaniem błędów; kontrakt w `shared/api.ts`,
  udostępniany w `src/preload` jako `window.journal`.
- `src/renderer`: React. Trasy w `store/ui.ts` (`Route`), pasek nawigacji i skróty w `app/App.tsx`.
- Okno: jedno `BrowserWindow`, contextIsolation + sandbox, jedna instancja aplikacji. CSP wstrzykiwane przy buildzie
  (`electron.vite.config.mts`): `connect-src 'self' journal-file:`. **Renderer nie może otworzyć WebSocket ani
  połączyć się z EODHD**: strumień, REST i magazyn świec muszą żyć w procesie głównym (albo w jego wątku roboczym),
  zgodnie z zasadą „z siecią łączy się tylko proces główny”.
- Brak dziś: zasobnika systemowego (Tray), powiadomień Windows (`Notification`), dźwięków, `safeStorage`,
  `powerMonitor` (uśpienie/wybudzenie), drugiego okna. Wszystko to jest w Electronie bez dodatkowych bibliotek;
  `safeStorage` na Windows używa DPAPI (wymóg 4.6 specyfikacji).
- Wątki: OCR działa już w wątku procesu głównego (`?nodeWorker`); ten sam wzorzec nada się do przeliczania detektorów.

**Przechowywanie danych.**
- Folder danych wybierany przez użytkownika (synchronizowany chmurą między komputerami): JSON z wcięciami, jeden plik
  na rekord, zapis atomowy, ULID, czasy UTC. Kolekcje: `trades`, `days`, `weeks`, `library`, `forecasts`, `drills`
  (`shared/paths.ts`). Ustawienia wspólne w `journal.json` (`settings`, `dictionaries`), m.in. `pairs`, `killzones`,
  `rules`, `risk`, `instruments`, `fx`, `goals`, `customFields`.
- Ustawienia per komputer: `userData/config.json` (`main/config.ts`: folder danych, okno, aktualizacje). Logi:
  `userData/logs/main.log` (rotacja przy 1 MB).
- `SCHEMA_VERSION = 1`. Nowe pola dodawane addytywnie bez podbijania wersji (np. `trade.broker`, `continuationOf`,
  `custom`), bo schematy to `z.looseObject` z domyślnymi wartościami, a nieznane pola są zachowywane.
  Pole „id sygnału” w transakcji (10.8) można dodać tak samo, bez migracji.
- Transakcja ma już pola potrzebne do „Wyślij do dziennika”: `pair`, `direction`, `entryTime`, `prices.entry`,
  `stopLoss`, `takeProfit1`, `takeProfit2`, `entryModelId` / `entryPdArrayId` / `htfPdArrayId` / `liquidityTakenIds`
  (słowniki ze stałymi ULID), `riskPercent`, `lots`, `screens` (pipeline kompresji WebP w rendererze).
- Pod skaner: wspólne dane (ustawienia, nadpisania biasu, sygnały, oceny) pasują do folderu danych jako nowe kolekcje
  addytywne (jak `forecasts`/`drills` w 1.3–1.4). Cache świec i klucz API muszą zostać w `userData`, poza folderem
  synchronizowanym.

**Wiele komputerów.** Komputery nie pracują jednocześnie, ale folder jest synchronizowany (Dropbox/OneDrive/Syncthing).
Obsługiwane są: kopie konfliktowe, heartbeat `.presence/`, scalanie trójstronne zmian z drugiego komputera
(`shared/merge.ts`), historia wersji `.history/`, `updatedBy`. Nowe kolekcje skanera dostaną to samo, jeśli będą
zwykłymi rekordami JSON zapisywanymi przez `DataStore`. Strumień EODHD na dwóch komputerach naraz dzieli limit
50 symboli (patrz 3.1).

**Styl interfejsu.** Ciemny motyw, tokeny w `renderer/styles/index.css`: `bg #0b0d10`, `panel #111418`, `raised`,
`line #1e232a`, `fg #c3cbd4`, jeden akcent `#e8a33d`, `up #2ebd85` / `down #f6465d` tylko dla wyniku; Inter + JetBrains
Mono (`.num`), bez gradientów i cieni, linie 1 px, animacje 120–160 ms. Pasek nawigacji po lewej (64 px, ikony).
Skróty Ctrl+1…9 są zajęte (Ctrl+2 = plan dnia), więc „Skaner” potrzebuje innego skrótu, np. Ctrl+0.
Kolory stref skanera (zielone = spadkowe, burgundowe = wzrostowe) to nowe tokeny, nie `up`/`down`.

**Build .exe i CI.** `.github/workflows/ci.yml` uruchamia się przy **każdym** pushu na dowolną gałąź, przy pull
requeście i ręcznie: testy na Linuksie (Node 22.12 / 24 / 26) → build na Windows (`build-windows.cmd`, Node
z `.node-version` = 24.21.0), smoke test, test aktualizacji → artefakt `ICT-Trade-Journal-windows-<sha>` z
`ICT-Trade-Journal-portable.exe` i `ICT-Trade-Journal-Setup.exe` (przechowywany 14 dni). Wydanie (`release`) tylko
na gałęzi domyślnej. **Gałąź robocza już ma buildy testowe bez zmian w workflow**: push tego kroku (commit `287ecb0`)
dał zielony przebieg CI nr 84 z artefaktem exe (Actions → CI → przebieg gałęzi → Artifacts). electron-builder:
`portable` + `nsis` x64, `asar: true`, pliki tylko z `out/`.

## 2. Materiały EODHD

- Plugin `eodhd-api` (`EodHistoricalData/eodhd-claude-skills`): instalacja przez `/plugin` jest interaktywna i nie
  działa w sesji w chmurze. Repozytorium (commit `9839c79` z 2026-10-10) zostało pobrane przez git i przeczytane jako
  dokumentacja: `skills/eodhd-api/references/` (endpointy, plany, limity, uwagi o FX). Nie jest dołączone do repozytorium.
- Dokumentacja Commodities API przeczytana na eodhd.com (strona „Commodities API … (beta)”).
- Opis planu „EOD+Intraday — All World Extended” w materiałach EODHD: 100 000 wywołań dziennie, 1000 zapytań na
  minutę, WebSocket dla FX/krypto/akcji USA, Intraday API tak, **Economic Events Data API: nie**,
  Macroeconomic Data API: nie, Financial Events (Calendar) API: nie.
- Rozbieżności dokumentacji ze specyfikacją i z praktyką:
  - dokumentacja WebSocket pisze „50 symboli na połączenie”; test pokazał limit **na klucz** (tak jak w specyfikacji);
  - błąd autoryzacji przychodzi już po otwarciu połączenia jako `{"status":403,…}` (klucz `status`, nie `status_code`),
    poprawna autoryzacja jako `{"status_code":200,"message":"Authorized"}`;
  - limit dzienny resetuje się o północy GMT (licznik odświeża się przy pierwszym zapytaniu po północy).

## 3. Test wykonalności (sekcja 4.1)

### 3.0 Konto (User API `/api/internal-user`)

| Pole | Wartość |
| --- | --- |
| Tryb / typ | `paid` / `monthly` |
| Limit dzienny | 100 000 wywołań (+500 bonusu) |
| Feedy | m.in. „Intraday Data API”, „Real-time Data via WebSockets”, „Live (delayed) Data API”, „EOD Historical Data”, „Search API”, „Exchanges List API”, „commodities” |
| Brak | Economic Events, Macroeconomic Data, Fundamentals, kalendarz |

Zużycie całego testu: ok. 390 wywołań z 100 000 (intraday kosztuje 5 wywołań za zapytanie).

### 3.1 Strumień FX – częściowo, reszta odroczona

Połączenie `wss://ws.eodhistoricaldata.com/ws/forex` z kluczem, jedna wiadomość subscribe z listą jako napisem.

- Autoryzacja: `{"status_code":200,"message":"Authorized"}` po ~0,3–0,6 s.
- **Przy zamkniętym rynku każdy istniejący symbol od razu wysyła jeden tick z ostatnią ceną** („migawka”), a nieznany
  symbol milczy. To pozwala sprawdzić istnienie symbolu w weekend:

| Symbol | Migawka | Uwagi |
| --- | --- | --- |
| EURUSD, AUDUSD, EURAUD, EURGBP, USDCHF | tak | |
| XAUUSD | tak | spread w migawce 3,36 USD (weekend) |
| WTIUSD | tak | ostatni tick pt 20:56 UTC (16:56 NY), `ppms: true`, spread 0,074 |
| USDPLN, EURPLN | tak | przeliczenie na PLN |
| USDJPY, GBPUSD, USDCAD, USDSEK (DXY) | tak | |
| EURJPY, EURCHF, EURSEK (EURX) | tak | |
| NZDUSD (SMT), XAGUSD | tak | |
| XBRUSD (Brent) | **cisza** | jest na liście REST FOREX, ale nie w strumieniu |
| XTIUSD, USOIL, UKOIL, BCOUSD, BRENTUSD, WTI, XNGUSD | cisza | nie istnieją |
| DXY, USDX, EURX, EXY, DE10Y, US30Y, FGBL, ZB | cisza | nie istnieją w strumieniu FX |

- Migawki FX mają znaczniki z **soboty** (np. EURUSD sob 20:31 UTC) – źródło notuje kwotowania także w weekend.
  Ticki spoza godzin rynku trzeba odrzucać.
- Tablica JSON w `symbols` → `{"status_code":422,"message":"Action and symbols should be string"}` (zgodnie ze specyfikacją).
- **Odroczone (po otwarciu rynku):** czy każdy instrument faktycznie streamuje w sesji (wykrywanie ciszy po migawce),
  częstotliwość ticków, typowy spread.

Mechanika sprawdzona na strumieniu krypto (`/ws/crypto`, BTC-USD, ETH-USD):

| Sprawdzenie | Wynik |
| --- | --- |
| Ticki | ok. 13 ticków/s łącznie dla 2 symboli; pierwszy tick ~0,4 s po otwarciu |
| Nieznany symbol (`FOO-BAR`) | przyjęty bez błędu, milczy |
| Wznowienie połączenia | po ponownym otwarciu przez 6 s zero ticków; po ponownym subscribe ticki wracają od razu |
| 45 symboli na połączeniu A + 10 na B | B: `{"status_code":422,"message":"Symbols limit reached"}`, **zero** symboli z B |
| 55 symboli w jednej wiadomości | `Symbols limit reached`, **cała subskrypcja odrzucona** (zero ticków) |

Wniosek: limit 50 symboli jest wspólny dla klucza (wszystkie połączenia, także drugi komputer), a przekroczenie
odrzuca całą wiadomość subscribe. Skaner musi liczyć budżet przed wysłaniem i rozpoznawać `Symbols limit reached`.

**Budżet symboli dla listy startowej:** 7 instrumentów (AUDUSD, EURAUD, EURGBP, EURUSD, USDCHF, XAUUSD, WTIUSD)
+ DXY: USDJPY, GBPUSD, USDCAD, USDSEK (EURUSD i USDCHF już są) + EURX: EURJPY, EURCHF, EURSEK + SMT: NZDUSD
+ przeliczenie: USDPLN = **16 z 50**. Dwa komputery naraz: 32 z 50.

### 3.2 Złoto (XAUUSD) – tak, z zastrzeżeniem

- Na liście `exchange-symbol-list/FOREX`: tak („Gold Spot US Dollar”); w strumieniu: tak (migawka).
- Historia: **tylko interwał 1m.** Interwały 5m i 1h zwracają pustą listę dla każdej sprawdzonej daty
  (2020–2026). 1m jest dostępne co najmniej od 2023-10-16 (1381 świec/dobę).
- Wniosek: H1, H4, D, W dla złota trzeba składać z 1m (dla EURUSD i tak jest to zalecane – patrz 4.2).

### 3.3 WTI – live tak, historii brak

- Lista FOREX (997 symboli): brak WTI. Jest `XBRUSD` (Brent spot), ale z rzadkimi świecami (1163 minut w tygodniu
  zamiast ~7200) i bez strumienia.
- **Strumień FX ma `WTIUSD`** (ostatni tick w piątek 16:56 NY, czyli zgodnie z zamknięciem ropy).
- REST dla `WTIUSD.FOREX`: intraday 1m/5m/1h → 404, `/eod` → „Ticker Not Found”, `/real-time` → same „NA”.
- Commodities API (`/commodities/historical/WTI`): dane z FRED, tylko dzienne, publikowane przez EIA raz w tygodniu
  (opóźnienie do tygodnia). Nie nadaje się do intraday.
- Zamienniki w EODHD: ETF `USO.US` (1m w godzinach USA z przedłużonym handlem, to nie jest cena ropy),
  `CRUD.LSE`/`WTI.LSE` (rzadkie świece), indeks `BCOMCL.INDX` (tylko dzienne).
- Warianty do planu: (a) WTI z bieżącego strumienia, historia zbierana od zera (bez D/H4/IPDA przez pierwsze tygodnie;
  luki, gdy komputer jest wyłączony), (b) drugi dostawca tylko dla historii WTI, (c) rezygnacja z WTI.

### 3.4 Indeksy i obligacje

| Instrument | Symbol EODHD | 1m | 1h | Dzienne | Uwagi |
| --- | --- | --- | --- | --- | --- |
| DXY | `DXY.INDX` | — | — | tak | „US Dollar Currency Index” |
| DXY (ICE) | `NYICDX.INDX` | — | tak, tylko 13:30–20:00 UTC | tak | 8 świec/dzień, nie całą dobę |
| EURX | `EXY.INDX` | — | — | tak | „Euro Currency Index” (PHLX) |
| T-Bond (ZB) | — | — | — | — | brak kontraktu ZB |
| Rentowność 30Y USA | `TYX.INDX` | — | tak, 12:20–18:20 UTC | tak | odwrotność ceny ZB |
| Bund (FGBL) | `FGBLZ26.US` | — | — | tak | kontrakt grudniowy, wymaga rolowania |
| Rentowności (GBOND) | `US30Y.GBOND`, `DE10Y.GBOND` | — | — | 403 | poza planem |
| `US30Y.INDX`, `US10Y.INDX` | | — | — | tak | tylko dzienne |

Wniosek: DXY i EURX tylko syntetycznie z par (wszystkie składniki dostępne live i w historii 1m).

**Weryfikacja stałych (faza 1, 11.10.2026):** syntetyczny DXY ze wzoru ICE na minutówkach EODHD vs indeks ICE
`NYICDX.INDX` (świece 1h, 122 pomiary 21.09–9.10.2026, cena na koniec godziny): mediana różnicy **0,003%**,
maks. 0,13%, kierunek zmian godzinowych zgodny w 94 na 105 (pozostałe to ruchy poniżej szumu). Dla EURX EODHD nie
ma wzorca (`EXY.INDX` to inny indeks); wartości syntetyczne o 17:00 NY do porównania z TradingView:
5.10 – 108,346; 6.10 – 108,567; 7.10 – 108,152; 8.10 – 108,178; 9.10 – 108,120. Dla obligacji:
bias D możliwy z danych dziennych (FGBLZ26, TYX/US30Y), H4 nie – ręczne ustawienie zgodnie z sekcją 7.4.

### 3.5 Świeżość REST intraday – odroczone

- Pomiar wymaga otwartego rynku. Dziś: o 21:13 UTC w sobotę historia 1m EURUSD kończyła się w piątek o 23:59 UTC
  (obejmuje weekendowy szum), USDPLN w sobotę o 04:43 UTC – nic to nie mówi o opóźnieniu w trakcie sesji.
- Dokumentacja: finalizacja 2–3 h po zamknięciu rynku. `/real-time/EURUSD.FOREX` („opóźnione 1 min”) zwraca
  tylko ostatnią cenę (bez świec), dla XAUUSD i WTIUSD same „NA” – do łatania luk się nie nadaje.
- Pomiar po otwarciu: kilka razy w sesji London/NY różnica „teraz − ostatnia świeca 1m” dla EURUSD i XAUUSD.

### 3.6 Kalendarz makro – niedostępny

`GET /api/economic-events?from=2026-10-12&to=2026-10-16&country=US` → **403** „Forbidden. Please contact support”.
Zgodne z opisem planu (Economic Events Data API: nie). Potrzebne inne źródło (pytanie 4 z sekcji 15). Uwaga na przyszłość:
w dokumentacji odpowiedź tego endpointu nie ma pola „ważności” (impact), więc nawet po dokupieniu klasyfikacja
high-impact szłaby po liście nazw wydarzeń.

### 3.7 Zgodność cen z TradingView – zrobione

Źródło porównania: eksport z TradingView od użytkownika (EURUSD, OANDA): 300 świec H1 (23.09–9.10.2026) i świece D
(od 08.2025). Po stronie EODHD: świece złożone wyłącznie z minutówek (REST 1m), tylko godziny rynku (niedziela
17:00 NY → piątek 17:00 NY), granica doby 17:00 NY, H1 wyrównane do pełnych godzin. Różnica = EODHD − TradingView, w pipsach.

**Wynik: zgodność bardzo dobra.**

| Świece | Liczba | Pole | Średnia | Mediana \|Δ\| | 90% świec \|Δ\| ≤ | Max \|Δ\| |
| --- | --- | --- | --- | --- | --- | --- |
| H1 | 300 | open | +0,04 | 0,1 | 0,4 | 10,1 |
| H1 | 300 | high | −0,05 | 0,1 | 0,4 | 9,0 |
| H1 | 300 | low | +0,07 | 0,1 | 0,3 | 1,2 |
| H1 | 300 | close | +0,01 | 0,1 | 0,4 | 3,9 |
| D | 14 | open | +0,34 | 2,2 | 5,0 | 10,1 |
| D | 14 | high | +0,05 | 0,2 | 0,3 | 1,6 |
| D | 14 | low | +0,10 | 0,1 | 0,2 | 0,4 |
| D | 14 | close | −0,16 | 0,4 | 0,7 | 1,5 |

(D: tylko dni w pełni objęte pobranymi minutówkami od 22.09.)

- **Typowa różnica feedu: 0,1 pipsa**, w 90% świec do 0,3–0,4 pipsa. PDH/PDL zgadzają się z TradingView do 0,1–0,4 pipsa
  (max 1,6 p). To jest tolerancja dla kryterium odbioru „PDH i PDL zgadzają się z TradingView”.
- **Wyjątek: świece o 17:00 NY** (otwarcie po przerwie dobowej, a zwłaszcza niedzielne otwarcie). Największe odchylenia H1:
  niedziela 27.09 17:00 (high +9,0 p), 8.10 17:00 (+2,2 p), 28.09 17:00 (+1,2 p). W tych minutach spread jest szeroki
  i każdy dostawca notuje inne pierwsze ceny. Dlatego **open świecy D różni się typowo o 2,2 p (do 10 p)**, a high/low
  dzienne już nie. Do planu: NDOG/NWOG (luka 17:00 → 18:00 NY, otwarcie tygodnia) mogą odbiegać od TradingView
  o kilka pipsów. Trzeba to pokazać w definicjach, a ewentualnie pomijać pierwsze minuty po otwarciu.
- **Bid czy mid (wstępnie).** Średnie różnice wynoszą ok. 0 (−0,05 … +0,07 p). Gdyby EODHD 1m było liczone z mid,
  a TradingView z OANDA bid, przy typowym spreadzie EURUSD ok. 0,2 p (migawki ze strumienia) średnia wynosiłaby ok.
  +0,1 p. Wynik wskazuje raczej na bid, ale różnica jest na granicy szumu. Rozstrzygnie porównanie świec ze strumienia
  (bid i mid) z REST i TradingView w sesji. Do tego czasu domyślnie: **bid**.

Wiersze z tabeli kontrolnej:

| Dzień (świeca D, koniec 17:00 NY) | Open | High | Low | Close | TV High | TV Low | Δ High | Δ Low |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| pon 2026-10-05 | 1.12583 | 1.12617 | 1.11613 | 1.12231 | 1.12614 | 1.11612 | +0,3 | +0,1 |
| wt 2026-10-06 | 1.12232 | 1.12766 | 1.12030 | 1.12593 | 1.12768 | 1.12028 | −0,2 | +0,2 |
| śr 2026-10-07 | 1.12595 | 1.12630 | 1.11650 | 1.11965 | 1.12632 | 1.11646 | −0,2 | +0,4 |
| czw 2026-10-08 | 1.11964 | 1.12266 | 1.11721 | 1.12113 | 1.12269 | 1.11720 | −0,3 | +0,1 |
| pt 2026-10-09 | 1.12115 | 1.12428 | 1.11876 | 1.12017 | 1.12428 | 1.11876 | 0,0 | 0,0 |

| H1 (godzina otwarcia, czas NY) | Open | High | Low | Close | TV High | TV Low | Δ High | Δ Low |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| wt 2026-10-06 03:00 | 1.12106 | 1.12426 | 1.12032 | 1.12407 | 1.12430 | 1.12030 | −0,4 | +0,2 |
| wt 2026-10-06 09:00 | 1.12587 | 1.12661 | 1.12471 | 1.12505 | 1.12660 | 1.12470 | +0,1 | +0,1 |
| śr 2026-10-07 08:00 | 1.11827 | 1.11873 | 1.11650 | 1.11734 | 1.11880 | 1.11646 | −0,7 | +0,4 |
| czw 2026-10-08 04:00 | 1.11953 | 1.12001 | 1.11861 | 1.11901 | 1.12006 | 1.11861 | −0,5 | 0,0 |
| czw 2026-10-08 10:00 | 1.11954 | 1.12266 | 1.11925 | 1.12080 | 1.12269 | 1.11926 | −0,3 | −0,1 |
| pt 2026-10-09 08:00 | 1.12090 | 1.12121 | 1.11928 | 1.11978 | 1.12122 | 1.11927 | −0,1 | +0,1 |

Dodatkowe potwierdzenie z punktu 4.2: gdyby użyć gotowych świec 1h z EODHD, różnice wobec TradingView byłyby
rzędu 3 p (to inne źródło). Składanie wszystkiego z minutówek jest więc konieczne.

## 4. Dodatkowe ustalenia ważne dla planu

1. **Weekendowy szum.** REST 1m ma świece przez cały weekend (EURUSD: 60 świec na godzinę w sobotę, zakres 6–9 pipsów,
   skoki w niedzielę przed otwarciem). Strumień też wysyła sobotnie kwotowania. Dzienne `/eod` mają nawet świece
   z soboty i niedzieli. Agregacja musi brać tylko minuty od niedzieli 17:00 NY do piątku 17:00 NY (plus święta).
2. **Tylko 1m jako źródło.** Tydzień EURUSD (5 dni): 1h z REST vs H1 złożone z 1m różni się w high o mediana 2,7 p
   (max 10,7 p), w low mediana 3,6 p (max 67 p); 5m daje podobne różnice. 1h ma pustą świecę (wszystkie pola null),
   5m ma świecę z błędnym low (~0). Dokumentacja potwierdza, że 1m i 5m pochodzą z różnych źródeł.
3. **Kompletność 1m.** EURUSD, tydzień 4–9.10: 7199 z 7200 minut (jedna brakująca). Pole `volume` jest niezerowe (to nie
   jest wolumen rynkowy – nie używać, zgodnie ze specyfikacją).
4. **Głębokość 1m.** EURUSD i XAUUSD: dostępne co najmniej od 2023-10. 3 lata 1m to ok. 1,1 mln świec na symbol
   (ok. 120 MB JSON do pobrania na symbol, ok. 50 wywołań). Do decyzji w planie: 3 lata z 1m dla wszystkich symboli
   czy krótsza głębokość dla składników indeksów.
5. **Dzienne `/eod` dla FX** mają granicę 23:59 UTC (dokumentacja EODHD), a nie 17:00 NY – nie nadają się do PDH/PDL.
   Przykład EURUSD 5.10: `/eod` high 1.12558, świeca 17:00 NY z 1m: 1.12617.
6. **Czas świec REST** = czas otwarcia świecy, UTC.
7. **Migawka przy subscribe** pozwala sprawdzić symbol bez czekania na sesję, ale wykrywanie „cichego strumienia”
   musi ją pomijać (jeden tick po subscribe nie znaczy, że symbol streamuje).

## 5. Odroczone punkty i jak je zamkniemy

| Punkt | Co zrobię | Co potrzebne od Ciebie |
| --- | --- | --- |
| 4.1.1 strumień FX | 10–15 min nasłuchu w sesji: ticki na symbol, cisza, spread | nic (albo uruchomienie skryptu u siebie, jeśli strumień z chmury nie zadziała) |
| 4.1.5 świeżość REST | kilka pomiarów „teraz − ostatnia świeca 1m” w London i NY | nic |
| 4.1.7 bid czy mid | świece ze strumienia (bid i mid) vs REST i TradingView | ewentualnie nowy eksport H1 z TradingView po sesji |

Rynek otwiera się w niedzielę 11.10 o 17:00 NY (23:00 w Polsce). Fazy 1–3 i 6 mogą powstawać na historii bez czekania;
część „live” fazy 1 zamknę po tych pomiarach.
