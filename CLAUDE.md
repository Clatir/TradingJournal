# ICT Trade Journal – ustalenia projektu

Osobisty dziennik day tradera forex (metodologia ICT). Aplikacja desktopowa Electron dla Windows, działa offline,
używana na kilku komputerach (nigdy jednocześnie). Interfejs po polsku, terminy ICT po angielsku. Z siecią łączy się
tylko proces główny: aktualizacje (GitHub) i kursy walut (tabela A NBP); oba można wyłączyć, nic nie jest wysyłane.

## Zasada współpracy
- Przed wykonaniem każdego zadania podaj użytkownikowi, jaki model i jaki poziom thinking będzie najodpowiedniejszy,
  dopiero potem wykonuj.

## Stack
- Electron 44 + React 19 + TypeScript 6 (strict) + Vite 7 (`electron-vite` 5) + Tailwind 4.
- Zależności w czystym JS: zod 4 (schematy), zustand 5 (stan), luxon (strefy, DST), ulid, yazl/yauzl (ZIP),
  cmdk (paleta), @tanstack/react-virtual, lightweight-charts 5 (equity). Słupki i heatmapy: własne komponenty SVG.
- OCR offline (1.4.6): tesseract.js-core 6 (`tesseract-core-simd-lstm.wasm.js`, wasm wbudowany w JS) + model
  `@tesseract.js-data/eng` (`4.0.0_best_int`, `?asset`) w wątku procesu głównego (`?nodeWorker`); działa też z `app.asar`.
- **Żadnych natywnych modułów Node.** Wszystkie biblioteki są w `devDependencies` i bundlowane do `out/`,
  więc `app.asar` nie zawiera `node_modules`.
- Testy: Vitest (`tests/unit`, `tests/fs`), Playwright `_electron` (`tests/e2e`, lokalnie pod `xvfb-run`).
- Build: electron-builder → `portable` + `nsis` (x64), stałe nazwy `ICT-Trade-Journal-portable.exe` i
  `ICT-Trade-Journal-Setup.exe`.
- CI: `.github/workflows/ci.yml`:
  - Linux: testy i build na Node 22.12.0/24/26, blokada na 22.11, sekcja wersji w CHANGELOG.
  - Windows: build, smoke i test aktualizacji do wersji +1 na Node 24.
  - Wydanie na GitHubie dla każdej nowej wersji na domyślnej gałęzi (patrz „Aktualizacje”).
- Node do budowania: ≥ 22.12 (Vite 7 / Vitest 5), zalecany 24 LTS; przypięta wersja w `.node-version` (używa jej
  `build-windows.cmd` → `scripts/build-win.ps1` i CI na Windows, gdzie systemowy Node celowo jest stary: 20.12).
  `.cmd`/`.ps1` mają CRLF (`.gitattributes`), `.ps1` w UTF-8 z BOM (Windows PowerShell 5.1).
- `allowScripts` w package.json (npm 11): skrypty instalacyjne zatwierdzone jawnie – esbuild tak, electron-winstaller
  (Squirrel, nieużywany) nie. Po aktualizacji zależności: `npm approve-scripts --allow-scripts-pending`. `package.json` nie ma `"type": "module"` (preload
  w sandboksie musi być CJS), dlatego konfiguracje mają rozszerzenie **`.mts`** (`electron.vite.config.mts`,
  `vitest.config.mts`) – jako `.ts` byłyby ładowane jako CJS i na Node bez require(esm) padały z `ERR_REQUIRE_ESM`
  (std-env). Bez require(esm) i tak nie działają electron-builder 26 (ESM-only `@noble/hashes` 2) ani instalator
  binarki Electrona (`electron/install.js` → ESM-only `@electron/get`, uruchamiany leniwie przy dev/E2E), więc
  `scripts/check-node.mjs` (preinstall, predev, prebuild, prestart, pretest) przerywa z instrukcją po polsku.

## Komendy
```
npm ci
npm run dev          # tryb deweloperski
npm test             # unit + fs
npm run typecheck
npm run build        # out/
npx playwright test  # E2E (po npm run build); Linux: xvfb-run -a npx playwright test
npm run dist:win     # release/*.exe (na Windows natywnie; na Linuksie potrzebny wine64 + wine32 dla NSIS)
build-windows.cmd    # Windows bez wymagań co do Node: pobiera Node z .node-version do .tools\ (SHA-256), npm ci/test/dist:win
node scripts/calibrate-webp.mjs [plik.png]   # kalibracja jakości WebP (CHROMIUM_PATH=... jeśli trzeba)
node scripts/forecast-vectors.mjs            # model referencyjny prognozy → tests/fixtures/forecast-vectors.json (sprawdza sumę SHA-256)
```
E2E przeciw spakowanej aplikacji: `ICTJ_E2E_EXECUTABLE=<ścieżka exe> npx playwright test`.
Zmienne testowe:
- `ICTJ_USER_DATA`: izolowany userData;
- `ICTJ_DATA_DIR`: folder danych bez okna wyboru;
- `ICTJ_MACHINE_NAME`;
- `ICTJ_UPDATE_URL`: lokalny serwer zamiast api.github.com, dopuszcza http i sprawdzanie także w kopii „ręcznej”;
- `ICTJ_UPDATE_CHECK_DELAY_MS`: opóźnienie pierwszego sprawdzenia, domyślnie 15 s;
- `ICTJ_NBP_URL`: adres bazowy lokalnego serwera kursów zamiast api.nbp.pl (dopuszcza http; aplikacja dopisuje
  `/api/exchangerates/tables/A?format=json`), `off` = bez łączenia. `launch()` w `tests/e2e/app.ts` ustawia domyślnie `off`;
- `ICTJ_NBP_FETCH_DELAY_MS`: opóźnienie automatycznego pobrania kursów po otwarciu folderu, domyślnie 20 s.

Test aktualizacji na Windows: `playwright.update.config.ts` (`tests/update`) z `ICTJ_UPDATE_FROM`/`ICTJ_UPDATE_TO`
(foldery z exe obu wersji) i `ICTJ_UPDATE_TO_VERSION`.

## Architektura
- `src/shared` – czyste TS używane przez main i renderer: `schema/` (zod = źródło typów), `calc/` (pipsy, R,
  statystyki, czas/killzone, pozycja, `forecast.ts`, `montecarlo.ts`), `migrations/`, `paths.ts` (układ folderu, nazwy,
  wzorce konfliktów), `records.ts` (parse/serialize), `api.ts` (kontrakt IPC), `fx.ts` (kursy), `instruments.ts`,
  `forecast-input.ts` (scenariusz + ustawienia → wejście obliczeń), `export/` (CSV, markdown, prognoza, XLSX).
- `src/main` – jedyny właściciel folderu danych: `datastore/store.ts` (skan, indeks plików, zapis atomowy,
  migracje, konflikty, screeny), `watch.ts` (Windows/macOS: natywny fs.watch rekursywny; Linux: watcher na każdy
  katalog, bo emulacja rekursji w Node gubi zmiany po rename/nowym inode; + skan kontrolny co 30 s), `presence.ts`
  (heartbeat `.presence/`), `config.ts` (ustawienia per komputer w userData), `log.ts` (userData/logs/main.log),
  protokół `journal-file://data/<ścieżka względna>` do obrazów.
- `src/preload` – `window.journal` (contextBridge). Okno: contextIsolation, sandbox, CSP wstrzykiwane przy buildzie.
  Jedna instancja aplikacji (`requestSingleInstanceLock`, blokada per userData) – drugie uruchomienie pokazuje okno.
  Zmiana folderu: najpierw otwarcie nowego, dopiero po sukcesie zamknięcie bieżącego.
- `src/renderer` – React; `store/journal.ts`: wszystkie rekordy w pamięci, autozapis (debounce 400 ms, max 2 s),
  nowe wpisy jako szkic do pierwszej zmiany; zmiany z dysku nie nadpisują niezapisanych lokalnych edycji.
  Nieudany zapis zostaje w pamięci i jest ponawiany (2 s → … → 60 s); `flushSaves()` zapisuje wszystko, co niezapisane,
  i zwraca `false`, gdy coś zostało – wtedy zamknięcie okna pyta, a zmiana folderu jest wstrzymana.
  W folderze tylko do odczytu edycje nie są przyjmowane. Zmiany z drugiego komputera: patrz „Dwa komputery i historia”.

## Dane (folder wybierany przez użytkownika)
```
journal.json                         ustawienia, słowniki, schemaVersion
trades/RRRR/RRRR-MM-DD_PARA_ULID.json  data = data NY wejścia
days/RRRR/RRRR-MM-DD.json            plan dnia (sekcje per para)
weeks/RRRR-Wnn.json                  przegląd tygodnia (tydzień ISO)
library/ULID.json                    biblioteka setupów
forecasts/ULID.json                  scenariusz prognozy wypłat (z zapisanymi losowaniami)
drills/ULID.json                     sesja treningu (karty z odpowiedziami, 1.4.0)
screens/RRRR/MM/ULID_etykieta.webp  (+ .thumb.webp)
backups/                             kopie ZIP (wyłączone ze skanu)
.presence/                           heartbeat komputerów (ignorowany przez skan)
.history/<rodzaj>/<id>/*.json        poprzednie wersje wpisów (ignorowane przez skan, watcher i kopie ZIP)
```
- JSON z wcięciami (2 spacje) i końcowym `\n`; czasy UTC ISO 8601; identyfikatory ULID; ścieżki **względne** z `/`.
- Każdy rekord: `schemaVersion`, `id`, `createdAt`, `updatedAt` (+ `updatedBy` = nazwa komputera, ustawiane przez main
  przy zapisie, od 1.4.0). Nieznane pola są zachowywane (`z.looseObject`).
- Transakcja zapisuje informacyjny blok `computed` (pipsy, R, killzone…) – ignorowany przy odczycie.
- Słowniki: pozycje z ULID, rekordy odwołują się po `id`, usuwanie = archiwizacja.
- Zapis atomowy: `.nazwa.tmp-xxxx` → fsync → rename (retry na EPERM/EBUSY). Pliki `.tmp-` i ścieżki z kropką są ignorowane.
- Uszkodzony / niepoprawny JSON: pomijany, lista problemów, nigdy nienadpisywany. Gdy zapis trafia w ścieżkę takiego pliku,
  plik jest odsuwany jako `nazwa-uszkodzona-<czas>.json` (kopia konfliktu); plik w nowszym formacie blokuje zapis.
  Uszkodzony `journal.json` w trakcie pracy: zostają ostatnie dobre ustawienia, plik na liście problemów.
- Konflikty chmury: kopie `nazwa-KOMPUTER.json`, `nazwa (1).json`, Dropbox „conflicted copy”/„kopia powodująca konflikt”,
  Syncthing `.sync-conflict-`, duplikaty `id`, `-zewnetrzna-<czas>` (plik zmienił się w tle tuż przed zapisem),
  `-uszkodzona-<czas>` (uszkodzony plik odsunięty przy zapisie).
  Rozstrzygnięcie: zachowana wersja zapisana jako kanoniczna, druga do Kosza (`shell.trashItem`, fallback: usunięcie).
- `schemaVersion`: aplikacja = `SCHEMA_VERSION` w `src/shared/schema/common.ts`. Starszy folder → pełny ZIP
  `backups/pre-migration/` i migracja; nowszy folder → tylko odczyt (blokada w main). Pojedynczy starszy plik →
  oryginał do `backups/pre-migration/<czas>/`, migracja. Brak `schemaVersion` = v0 (płaski format, patrz migrations).
- Zmiana formatu: podbij `SCHEMA_VERSION`, dodaj krok `N → N+1` dla każdego rodzaju w `migrations/index.ts`, dodaj test.

## Czas i obliczenia
- Zapis UTC; widok i wpisywanie NY + Warszawa (oba pola edytowalne), DST przez luxon/IANA.
  Godziny nieistniejące/podwójne są oznaczane (podwójna → wcześniejsza).
- Killzone'y w czasie NY (start włącznie, koniec wyłącznie, okna przez północ). Domyślne: London 02–05,
  New York 07–10, SB 03–04, 10–11, 14–15. Dzień handlowy = data NY wejścia.
- R = Σ(% × kierunek × (wyjście − wejście) / |wejście − SL|); przy sumie partiali ≠ 100% wynik proporcjonalny + flaga.
- BE: |R| ≤ 0.1 (edytowalne) – poza win rate, ale w expectancy/PF/equity. BE nie przerywa serii.
- Missed trades: wynik hipotetyczny (TP1/TP2/SL/nic), poza statystykami wyniku.
- Pozycja: loty = kapitał × % / (SL pips × contractSize × pipSize × kurs kwotowana→konto), w dół do kroku lota.
- Skala pary (1.4.5, `src/shared/pairs.ts`): `pair.contractSize` (jednostek w locie; brak = instrument o tym samym id,
  potem `risk.contractSize`) dla kalkulatora pozycji i wyniku z lotów (`lotValueFor`); `pair.maxStopPips` = własny
  limit zasady SL (brak = `rules.maxStopPips.value`). Ropa (`isOilSymbol`: WTI, OIL, USOIL, XTI, BRENT, UKOIL…):
  `pairPreset` → pips 0.01, 2 miejsca, 1 lot = 1000 baryłek, USD; `oilScaleMismatch` → przycisk „Ustaw jak ropa”.
- Zysk/strata (`calc/pnl.ts`, panel `features/calculator/PnlCalculator.tsx`):
  P/L = pipsy × wartość pipsa najmniejszego lota × loty / najmniejszy lot.
  - Presety AUDUSD/EURGBP/EURUSD/EURAUD: pips 0.0001, lot = `risk.contractSize`, przez kurs waluty kwotowanej.
  - Preset WTI: pips 0.01, 1 lot = 1000 baryłek.
  - Ręczne wartości pipsa: `risk.pipValuesPerLot[id]` (także `CUSTOM`). Są zapisane **na 1 lot**, a pokazywane na
    najmniejszy lot, więc zmiana kroku lota nie zmienia ich znaczenia. Wartości z 1.2.0 (`risk.pipValues`, na najmniejszy
    lot) przelicza transform schematu przy wczytaniu.
  - Instrumenty: `settings.instruments` (Ustawienia → Instrumenty). Pusta lista (dziennik z 1.2.x) jest zasiewana przy
    wczytaniu presetami i dawnym instrumentem własnym (`risk.customInstrument` → `CUSTOM`); identyfikatory presetów
    zostają, więc `pipValuesPerLot` działa bez zmian. Import (scal) dołącza brakujące instrumenty.
  - Pola pomocnicze (instrument, loty, pipsy) pamiętane tylko w sesji.
  - Partiale (`calc/partials.ts`, panel `features/calculator/PartialsCalculator.tsx`): zamknięcie całości teraz albo
    1–4 części („teraz” albo cel w pipsach, ostatnia bierze resztę %, loty w dół do kroku), opcjonalnie SL reszty na BE
    po pierwszym partialu w zysku. Scenariusze: osiągnięte 0…N celów (w kolejności odległości), reszta na SL/BE;
    `beatsNowAfter` = od którego celu podział daje co najmniej tyle, co zamknięcie teraz. Szansa celu (`probability`,
    domyślnie 100%; dalszy cel ≤ bliższy, inaczej obniżana i `probabilityLowered`) → szansa scenariusza = szansa
    k-tego celu − szansa (k+1)-ego, `expected` = Σ szansa × wynik, `suggestion` split / now / equal (±0,005).
    `final` = cała pozycja na najdalszym celu: `cost` (= całość tam − podział przy wszystkich celach = Σ `costVsFinal`
    części), oczekiwany wynik trzymania całości (szansa ostatniego celu, reszta = cała pozycja na SL), `splitVsHold`.
    Optymalny podział (`calc/partialsOptimal.ts`, `optimalSplit`): kubełki „teraz” + cele (dalej niż teraz, szanse
    nierosnące), wszystkie podziały na siatce (≤ ~25k, max 4 części) + dopracowanie w krokach lota; ocena jak w
    `partialPlan` (test zgodności); kryteria 'ev' / 'noLoss' / 'maxLoss' (najgorszy przypadek o szansie > 0 ≥ −X·1R),
    remis → wyższy najgorszy przypadek, potem mniej części. Bez BE optimum 'ev' = jedno wyjście (liniowe w udziałach).
    `split.final` = koszt względem całości na najdalszym wpisanym celu (całość tam − podział przy wszystkich celach). Pola w sesji.
  - Pola liczb pokazują tyle miejsc po przecinku, ile ma wartość: `shownDecimals`, `lotDecimals` w `calc/position.ts`.
    Dotyczy też lotów w kalkulatorze pozycji, edytorze transakcji i CSV.
- Waluta konta: `switchAccountCurrency` (`src/shared/risk.ts`) odkłada `conversionRates` i `pipValuesPerLot` do
  `risk.byAccountCurrency[stara]` i przywraca te dla nowej waluty, bo to kwoty w walucie konta. Zmiana z kalkulatora
  pozycji (pole obok „Kapitał”) albo z ustawień idzie przez `changeAccountCurrency` (+ `setAccountCurrency` w
  `renderer/store/fx.ts`): saldo przeliczane kursem stara → nowa (`fx.manual` albo NBP); bez kursu zostaje i jest komunikat.
- Waluta kalkulatora: `risk.calcCurrency` (domyślnie PLN), `calculatorCurrency()` w `src/shared/risk.ts`. Cała strona
  kalkulatorów (pozycja, zysk / strata, partiale) liczy i pokazuje kwoty w tej walucie: kapitał = saldo konta × kurs
  konto → waluta kalkulatora (wpisany kapitał jest zapisywany z powrotem w walucie konta), kursy kwotowana → waluta
  kalkulatora, ręczne wartości pipsa przeliczane. Loty nie zależą od waluty. Bez kursu strona wraca do waluty konta.
- Kwoty transakcji (`riskAmount`, `pnlAmountOverride`) mają walutę `amountCurrency` (waluta konta przy wpisie). Pliki
  sprzed 1.3.0 jej nie mają: obowiązuje `risk.legacyAmountCurrency` (pierwsza waluta konta, zapamiętana przy pierwszej
  zmianie). `tradeMetrics` przelicza wynik na walutę konta kursem NBP z tabeli z ostatniego dnia publikacji przed dniem
  zamknięcia (`src/shared/fxHistory.ts`: `historicalRate`, `transactionDate`; `amountRateDate`), a gdy archiwum nie ma
  tego dnia – dzisiejszym kursem (`pnlAmount`, oryginał: `pnlAmountOwn`). Archiwum: `settings.fx.history`
  (waluta → zakres dat + kursy, w journal.json, więc także offline i na innych komputerach), pobierane przez main
  (`fetchFxHistory`, `rates/A/{kod}/{od}/{do}`, ≤ 367 dni) tylko dla brakujących zakresów (`historyNeeds`, `historyUses`)
  – po starcie, co godzinę i przy „Odśwież kursy NBP”;
  wynik w kwocie: wpisany → R × kwota ryzyka → z lotów (`amountSource` 'lots': pipsy × pipSize × kontrakt × loty
  w walucie kwotowanej; kontrakt z instrumentu o tym samym id albo `risk.contractSize`, `lotValueFor` w instruments.ts);
  bez kursu `pnlAmount` = null (nie udaje kwoty w walucie konta). CSV: „Wynik kwota (waluta konta)” i „Waluta kwot”.
  Edytor: pole „Waluta kwot” (poprawka waluty bez przeliczania); wpisana kwota jest w walucie pokazanej obok.

## Screeny (kalibracja)
- Pipeline w rendererze: `createImageBitmap` → skalowanie w dół (połowienie + high quality) do max 2560 px →
  `OffscreenCanvas.convertToBlob('image/webp')`; miniatura 480 px; oryginał nie jest zapisywany.
- Chromium przełącza WebP na bezstratny przy quality = 1.0 (bitstream `VP8L`).
- Kalibracja (`scripts/calibrate-webp.mjs`, wykresy lightweight-charts 1920×1080 w stylu TradingView):
  bezstratny = 0,96–1,26× rozmiaru q85–q90 i jest identyczny co do piksela; stratny ma PSNR chromy ≈33 dB niezależnie
  od jakości (podpróbkowanie 4:2:0 rozmywa kolorowe etykiety osi). Dlatego domyślnie **tryb auto**: koduj oba,
  zostaw bezstratny gdy ≤ 1,3× stratnego (q90). Tryby do wyboru: auto / stratny / bezstratny.

## Analityka i dane przykładowe
- `src/shared/calc/analytics.ts`: populacja statystyk = zamknięte z wynikiem (missed osobno). Sesja = pierwsza pasująca
  killzone rodzaju „killzone”, inaczej SB, inaczej „poza KZ”. Koszt tagu = Σ R z tagiem − n × średnie R transakcji bez tagów.
- Equity: lightweight-charts BaselineSeries (zielone nad 0, czerwone pod 0) + histogram drawdown w drugim panelu.
  Słupki/heatmapy: własne SVG (`components/charts`). `EquityChart` ma `format` osi (R domyślnie, PLN).
- Krzywa zarobków w PLN (1.4.9, `shared/calc/plnCurve.ts`, `PlnSection` w `AnalyticsPage`): zamknięte transakcje wg
  czasu zamknięcia; kwota własna → PLN jak w raporcie (`resultInPln`: NBP z dnia przed zamknięciem, inaczej dzisiejszy),
  bez kwoty → opcjonalnie `estimateAmount` (R × ryzyko % × saldo, waluta konta → PLN), reszta pominięta i policzona
  (`noAmount`, `withoutRate`, `missingRates`); drawdown = equity − szczyt. Ukryte kwoty → przycisk `toggleMoney`.
- Dane przykładowe: `src/shared/sample/generate.ts` (deterministyczne, ziarno 1234, 30 wpisów, 3 missed), screeny
  rysowane canvasem (`features/sample/drawChart.ts`). Folder `userData/sample-journal` – osobny od prawdziwych danych;
  `config.lastRealDir` pamięta prawdziwy folder. Status `isSample` → baner DEMO.

## Biblioteka, tydzień, eksport, kopie
- Adnotacje: wektorowo w `ScreenRef.annotations` (współrzędne 0–1), rysowane SVG nad obrazem (`components/annotations.tsx`);
  rozmiar tekstu `fontScale` (addytywne, 1.6.1; S–XXL = 0,75–3 × domyślny, `[` / `]`, ostatni wybór w localStorage);
  „Kopiuj z adnotacjami” spłaszcza przez canvas do schowka (IPC `copyImage`). Plik WebP nigdy nie jest modyfikowany.
- Biblioteka może współdzielić pliki screenów z transakcją; usunięcie wpisu kasuje tylko screeny bez innych odwołań.
- Przegląd tygodnia: tydzień ISO, dni pon–pt wg daty NY; import CSV z TradingView („Export chart data”, czas UNIX lub ISO,
  separator `,` lub `;`) → `src/shared/calc/ohlc.ts`.
- Eksport: CSV (`src/shared/export/csv.ts`), markdown (`export/markdown.ts`, Ctrl+Shift+M), ZIP folderu bez `backups/`.
- Raport miesięczny (`src/shared/export/monthlyReport.ts`, pasek w Analityce, akcje `features/export/reportActions.ts`):
  cały miesiąc NY, wszystkie pary, bez szkiców. PLN = `pnlAmountOwn` × `historicalRate(waluta kwot, PLN, transactionDate)`,
  inaczej `rateFor` (dzisiejszy); dopisek mówi, ile transakcji przeliczono i jak. Markdown albo PDF: `monthlyReportHtml`
  (bez skryptów, CSP `default-src 'none'`) → IPC `savePdf` → `main/export/pdf.ts` (ukryte okno, JS wyłączony, osobna
  sesja w pamięci blokująca wszystko poza `data:`, `printToPDF` A4).
- Import: folder lub ZIP (rozpakowanie bezpieczne – yauzl odrzuca `../`), walidacja każdego pliku bez zmian w danych,
  potem „scal” (polityka kolizji: nowsza / pomiń / nadpisz; słowniki i pary z importu dołączane) albo „otwórz jako osobny”.
- Screen XTB „Szczegóły pozycji” → transakcja (1.4.6, edytor → „Ze screenu XTB”, `features/trade/XtbScreenImport.tsx`):
  - renderer (`lib/ocr.ts`): powiększenie 3× (max 4000 px), skala szarości, ciemny motyw odwracany, rozciągnięcie
    kontrastu; trzy odczyty łączone `combineXtb` (wagi 1,2 / 1 / 0,9): każda wartość i symbol wycięte (`regions`)
    i czytane osobno (PSM 7, czasy PSM 6, `valueCharset` jako whitelist), cały panel w skali szarości (cyfry), cały
    panel po progowaniu 200 (szare etykiety; 170 i 225 tylko, gdy nie ma panelu). Pomiar na syntetycznych panelach
    (14 instrumentów × 2 skale, `Inter`/Liberation/DejaVu): 302/308, 308/308, 308/308 pól, ≈2,5 s na screen;
    progowanie psuło cyfry przy skali 100% (9 → 0), rozsuwanie znaków w wycinkach pogarszało wynik (gubi kropki);
  - main (`main/ocr/`): IPC `ocrImage(png, {psm, whitelist})` → wątek z Tesseractem, TSV; wątek kończy się po 60 s;
  - `shared/import/xtbScreen.ts`: etykiety (PL/EN, bez ogonków, literówki OCR, jedna cyfra szumu, „..”/„…” = prefiks,
    sklejone „zabezpiec..Swap” rozdzielane) → wartość pod etykietą w jej kolumnie (czasy: data + godzina w dwóch
    wierszach) albo obok; symbol = pierwszy wiersz nad etykietami z wielkimi literami (ikona przed nim pomijana,
    „OIL WTI” → „OIL.WTI”), pod nim `description`; cena bez kropki skalowana i ważona ×0,3 (`undotted`); głosowanie:
    zlana podwójna cyfra („0.8431” vs „0.84311”) → wygrywa dłuższa; rozbieżności w `uncertain` („sprawdź”).
    `matchInstrument`: dokładnie (`pairForSymbol`) → opis pary walut (`pairFromDescription`) → najbliższa para z tanimi
    pomyłkami OCR (S↔5, O↔0, A↔4…, wstawiona litera 0,6, doklejony znaczek 0,2/znak; próg 0,3 × długość + 0,3,
    przewaga ≥ 0,5). `expectedGross`/`resultMismatch`: wynik z cen × loty × kontrakt × kurs vs odczytany (> 25%).
    `screenValues`, `changedScreenFields`, `applyScreenValues` (wyjście = jedno 100%, wynik netto → `pnlAmountOverride`
    w walucie konta, `trade.broker` z `source: 'screen'`). „Dodaj do par” w oknie: `pairPreset`, waluta z opisu.
  - Screen nie jest zapisywany. `Ctrl+V` w oknie przechwytywane w fazie capture (nie trafia do panelu screenów).
  - E2E używa stałych plików `tests/fixtures/xtb-position*.png` (syntetyczne panele: EURUSD, US500, DE40): tekst
    rysowany canvasem jest rasteryzowany inaczej na Windows i Linuksie, więc OCR obrazu narysowanego w teście daje
    różne wyniki.
- Czas wyjścia/partiala: `ExitClockField` w NY i w WAW (`zone`), data od dnia wejścia w tej strefie, „+1” dla następnego dnia.
- Import historii od brokera (Ustawienia → Eksport, import, kopie; `renderer/features/settings/BrokerImport.tsx`):
  - plik: main `import/broker.ts` (`pickBrokerFile`: XLSX → arkusze przez yauzl, reszta → bajty), renderer dekoduje
    (`decodeText`: BOM UTF-8/16, UTF-8, Windows-1250) i dzieli na wiersze (`shared/import/tables.ts`: CSV/TSV, tabele HTML
    z raportów MT4/MT5 z rozwinięciem colspan, arkusze XLSX z datami ze stylów);
  - `shared/import/broker.ts`: nagłówek rozpoznawany po nazwach kolumn (EN/PL; „Time”/„Price” dwa razy = otwarcie,
    zamknięcie), koniec tabeli na wierszu-tytule albo kolejnym nagłówku, partiale (ten sam symbol, strona, czas i cena
    otwarcia) scalane w jedną pozycję z kilkoma wyjściami; netto = kolumna netto albo zysk + prowizja (+ podatki) + swap
    (+ rollover);
  - `shared/import/match.ts`: czas pliku: serwer MT = NY + 7 h, Warszawa (XTB), UTC; para z symbolu bez końcówek;
    ta sama para i kierunek, wejście w tolerancji, najbliższe najpierw, jeden do jednego; ticket zapisany w `trade.broker`
    = „już zaimportowana”, chyba że pozycja zmieniła się u brokera (zamknięta później, kolejny partial) – wtedy znów
    „dopasowana”, a wartości wpisane poprzednim importem liczą się jak puste. `applyBrokerMatch` uzupełnia puste pola (albo nadpisuje), SL tylko po stronie straty, wynik =
    netto w walucie konta brokera (nie, gdy kwota ryzyka wpisu jest w innej walucie); `tradeFromBroker` = nowy wpis.
  - `trade.broker` (addytywne, `SCHEMA_VERSION` bez zmian): tickety, liczby brokera, czasy UTC; duplikat wpisu go nie ma.
- Kopie przy starcie (`main/datastore/backup.ts`): `backups/daily/RRRR-MM-DD_json.zip` (14), `backups/weekly/RRRR-Wnn_full.zip`
  gdy najnowsza ≥ 7 dni (4), ręczne `backups/manual/` (5), przed migracją `backups/pre-migration/`. Demo nie ma kopii.

## Prognoza wypłat (1.3.0)
- Obliczenia: `simulateForecast` (`src/shared/calc/forecast.ts`) – czysta funkcja; wykonywalny wzorzec to `simulate()`
  w `scripts/forecast-vectors.mjs`. Plik `tests/fixtures/forecast-vectors.json` (T1–T10 prototyp, E1–E20 usprawnienia)
  generuje skrypt – nigdy nie poprawiaj go ręcznie; gdy test nie przechodzi, błąd jest w `forecast.ts`.
- Kwoty jako `number` (IEEE double, jak w prototypie), zaokrąglenie tylko przy wyświetlaniu; porównanie „czy starcza na cel”
  w groszach. Losowania (`drawUniforms`, `crypto.getRandomValues`) zapisane w scenariuszu: 4 × 240 liczb, ten sam wynik
  na każdym komputerze; krótsze tablice (plik edytowany ręcznie) są dolosowywane przy otwarciu.
- Strona: `renderer/features/forecast/` (pasek scenariusza, wypłata, panele, podsumowanie, porównanie, wykres, rozrzut,
  tabela z wpłatami i latami, eksport). Stan sesji (ostatni scenariusz, porównanie, zwinięte lata, skala, rozrzut)
  w `session.ts`, nie w plikach. Teksty statusów/podsumowania: czyste `texts.ts` (testowane; w `tsconfig.node.json`).
- Tryb pipsowy: instrument z `settings.instruments`, wartość pipsa najmniejszego lota (ręczna z `risk.pipValuesPerLot`
  albo wyliczona) przeliczona `rateFor` na walutę scenariusza (`forecastInputFrom`).
- Kursy (`src/shared/fx.ts`): kolejność: ta sama waluta → ręczny kurs konta (`risk.conversionRates`) → `fx.manual`
  („USD>PLN”) → tabela NBP (`fx.nbp`, mid/mid, PLN = 1). Pobiera proces główny (`src/main/fx/nbp.ts`, IPC
  `fetchFxRates`); zapis do ustawień tylko przy nowym numerze tabeli. Pobranie: 20 s po otwarciu folderu, gdy tabela
  ma ponad 12 h (`nbpFetchDue`), potem co godzinę, gdy brakuje tabeli z ostatniego dnia roboczego od 12:30 czasu
  warszawskiego (`nbpRecheckDue`, `expectedNbpDate`). Bez sieci kalkulatory liczą z ostatniej zapisanej tabeli.
  Kurs ręczny odbiegający od NBP o > 3% (`manualRateDeviation`, `MANUAL_RATE_WARN`) jest oznaczany przy polu i w ustawieniach.
- „Weź z moich wyników” (`FromJournal.tsx`, `calc/journalReturns.ts`): zwroty miesięczne dziennika (Σ R × ryzyko %
  zamkniętych transakcji wg miesiąca NY, miesiące bez transakcji = 0%), z nich zwrot losowy (p10–p90 miesięcy ≥ 0),
  szansa na miesiąc stratny i jego wielkość (p10–p90); min. 3 miesiące; podgląd przed ustawieniem.
- Eksport: `forecastTable` → TSV (schowek), CSV, XLSX (generator XML w `shared/export/xlsx.ts`, ZIP w `main/export/xlsx.ts`).
- `SCHEMA_VERSION` bez zmian (kolekcja addytywna): 1.2.x pomija `forecasts/` (kopia dzienna i import 1.2.x ich nie zawierają).

## Dwa komputery i historia zmian (1.4.0)
- Historia: `main/datastore/history.ts` (`RecordHistory`). Przed nadpisaniem/usunięciem main odkłada poprzednią wersję
  do `.history/<rodzaj>/<id>/<czas>_<powód>_<los>.json` (powody: edit, delete, restore, import, merge, discarded).
  Edycje z tego komputera najwyżej raz na 10 min, wersje z innego komputera (`updatedBy`), usunięcia, przywrócenia
  i importy zawsze; max 40 na wpis. IPC `historyList/Read/Deleted/Keep/Restore`; UI `features/history/`.
- `ChangeSet.origin`: 'external' (watcher / skan / rescan), 'local' (własny zapis, import, rozstrzygnięcie konfliktu).
- Renderer (`store/journal.ts`): `bases` = wersja z dysku sprzed lokalnych edycji. Zmiana zewnętrzna wpisu z niezapisanymi
  edycjami → `decideRemote` (`shared/remoteChanges.ts`): tryb `settings.sync.remoteChanges` 'merge' (domyślny) scala
  trójstronnie `merge3` (`shared/merge.ts`: obiekty pole po polu, tablice obiektów z `id` po `id`, inne tablice w całości,
  `updatedAt`/`updatedBy`/`computed` bez konfliktu) i pyta tylko o pola zmienione po obu stronach; 'ask' pyta zawsze.
  Oczekujące decyzje (`store/remote.ts`, `RemoteChangesDialog`) blokują zapis tego wpisu; odrzucona wersja → historia
  (`historyKeep`, powód 'discarded'). Usunięcie na drugim komputerze przy lokalnych edycjach też jest pytaniem.
- E2E: hak `__ICTJ_SAVE_DELAY__` (opóźnienie autozapisu) i `journal.rescan()` symulują drugi komputer.

## Sesje analizy, szablony dnia, samopoczucie (1.4.0)
- Sesje analizy portfolio w planie dnia (`day.sessions`): odcinki stopera (z opcjonalną parą), decyzja per para
  (trade / watch / reject + `reasonIds` ze słownika `rejectReasons`, stałe ULID domyślnych powodów), minuty, `review`.
  Obliczenia `shared/calc/sessions.ts` (czas na parę: wpisany > zmierzony odcinek + równa część czasu bez pary;
  `pendingReviews` po 3 h albo następnego dnia; `selectionStats` = lejek, czas/transakcję, czas/1R, trafność odrzuceń,
  przedziały czasu a wynik dnia). UI `features/sessions/` (stoper w TopBar, `Ctrl+Shift+A`), sekcja w raporcie miesięcznym.
- Szablony planu dnia: `settings.dayTemplates` (`shared/dayTemplates.ts`): wstawienie uzupełnia tylko puste pola,
  ★ domyślny szablon dla nowych planów (`newDayPlan`).
- Samopoczucie: `day.wellbeing` (sen h, energia i stres 1–5, notatka); pytanie rano w dni handlowe NY
  (`display.wellbeingPrompt`, odłożenie na dziś w localStorage); `shared/calc/wellbeing.ts` (grupy snu/energii/stresu).

## Trening, mapa godzin, własne pola i filtry (1.4.0)
- Mapa godzin: `shared/calc/heatmap.ts` (dzień tygodnia × godzina wejścia NY; Σ R, śr. R, win rate bez BE, liczba,
  błędy = tag błędu albo złamana zasada), komponent `components/charts/WeekdayHourHeatmap.tsx`.
- Trening (`Ctrl+8`, `features/drill/DrillPage.tsx`, `shared/calc/drills.ts`): karta = zamknięta albo missed z wynikiem
  i screenem „przed”. Kolejność: nigdy nie ćwiczone → ostatnio błędne → najdawniej powtarzane (losowo w grupach).
  Odpowiedź zapisuje `truth` z chwili odpowiedzi. Ocena: decyzja (zysk → wziąć w kierunku, strata → odpuścić, BE bez
  oceny), kierunek (gdy wchodzisz), SL „blisko” ≤ max(2 p, 25% SL). Nowa sesja jest szkicem do pierwszej odpowiedzi.
- Własne pola: `settings.customFields` (select / number / check / text, opcje jak słownik), wartości `trade.custom[fieldId]`
  (select = id opcji). `shared/journalView.ts`: `withCustomValue`, `filterRows` (wyszukiwanie obejmuje wartości pól),
  kolumny (`BUILTIN_COLUMNS`, `cf:<id>`, `settings.journalView.columns`, null = domyślne), zapisane filtry
  (`settings.savedFilters`, `sameFilter` bez pustych warunków). Analityka `customFieldBreakdowns`, CSV i markdown
  dopisują pola. Import (scal) dołącza pola i opcje po `id`.
- Kwota w dzienniku (1.4.8): `tradeAmount` (`shared/journalView.ts`) = `m.pnlAmount` (wpisany / R × kwota ryzyka /
  z lotów), inaczej szacunek R × `riskPercent` × `risk.accountBalance` (oznaczony „≈”, tylko lista dziennika i jej Σ,
  nie analityka), inaczej null z podpowiedzią (brak kursu, brak danych). Dodanie kolumny `amount` włącza
  `display.showMoney` (`features/money.ts` `toggleMoney`); `toggleColumn` stawia ją za `r`. Lista przewija się w bok
  (`gridMinWidth` = minima kolumn + odstępy), gdy kolumny nie mieszczą się obok podglądu.

## Raporty, cele, porównanie, PIT-38 (1.5.0), kontynuacje (1.5.1)
- Strona Raporty (`features/reports/ReportsPage.tsx`, ikona na pasku, `Ctrl+9`): okres miesiąc / kwartał / rok / własny
  (`shared/calc/periods.ts`: `monthRange`, `quarterRange`, `yearRange`, `previousRange` – całe miesiące przesuwane
  o miesiące, inaczej o dni –, `rangeLabel`, `periodMetrics`), sekcje `REPORT_SECTIONS` (wybór w localStorage
  `ictj.report.sections`, kolejność zawsze raportu). `buildReport(rows, days, journal, range)` (okres > 62 dni →
  podział na miesiące), `reportSections(r, include)` → podgląd, `monthlyReportMarkdown/Html(r, include)`;
  `buildMonthlyReport` = miesiąc. Nazwy plików `raport_RRRR-MM`, `raport_RRRR`, `raport_od_do`.
- PIT-38 (`shared/calc/tax.ts`, `taxSummary`): data zamknięcia w Warszawie (`transactionDate`) w zakresie, tylko kwoty
  własne (`pnlAmountOwn`), kurs PLN = 1 → `historicalRate` → `rateFor` (orientacyjny, `rateDate` null), grosze.
- Cele (`settings.goals`, addytywne: `dailyLossPercent`, `weeklyLossLimitR`, `weeklyTargetR`, `monthlyTargetR`, `ask`),
  `shared/calc/goals.ts` (`goalState`: dzień z `dailyLimitState` + % konta = Σ R × (ryzyko % ?? domyślne), tydzień ISO
  i miesiąc NY, `alerts`), `useGoals` w `store/derived.ts`, pasek górny, panel „Limity i cele” w kalkulatorze.
  `newTrade('trade')` przy alertach i `goals.ask` → `LimitPromptDialog` (`features/goals/LimitPrompt.tsx`).
- PLN w Analityce: `tradePln` / `plnByTrade` (`calc/plnCurve.ts`, jak krzywa PLN, z szacunkiem wg pola w panelu
  PLN) → `breakdowns`/`customFieldBreakdowns`/`calendarDays(…, plnOf)` (`Group.pln`, `plnCount`; `GroupTable money`,
  `CalendarHeatmap metric`). Porównanie okresów: `ComparisonSection` w `AnalyticsPage`.
- Kontynuacja (1.5.1, `shared/calc/continuation.ts`): `trade.continuationOf` (addytywne) = id zamkniętej transakcji
  otwartej ponownie. `continuationCheck` (ta sama para i kierunek, wejście po zamknięciu = ostatnie wyjście z czasem,
  ta sama data NY co zamknięcie; łańcuch do pierwszego wejścia) → `validateTrade(…, continuation)`: zasada KZ z
  pierwszego wejścia, nieważna = jak nowe wejście + powód. Wiersze `TradeRow.continuation`, cache walidacji po łańcuchu;
  `dailyLimitState` nie liczy kontynuacji do liczby transakcji, `goalState(…, {reopening})` bez alertu liczby.
  `reopenTrade` (edytor „↻ Otwórz ponownie”), `continuationCandidate` (podpowiedź), `ContinuationBox`,
  `breakdowns.entry`, `computed.continuation` (main: `SerializeContext.trade`), CSV/markdown; duplikat ją czyści.

## MAE / MFE ze screena TradingView (1.6.0)
- `shared/import/tvChart.ts` (czyste, na pikselach RGBA i słowach OCR):
  - oś: `readAxisWords` (pas przy prawej krawędzi ×3 w skali szarości, odwrócony przy ciemnym wykresie → kolumna
    etykiet `labelColumn` czytana ponownie; bez kolumny kafelki), `AXIS_OCR` = PSM 11 + cyfry; `axisLabels` (brakująca
    kropka z miejsc pary, skala ×10ⁿ wg wejścia, etykiety bez wiodących cyfr / zaczynające się od „.” = sufiks);
    `fitPriceScale` (RANSAC + MNK, tylko kolumna etykiet, grupa stawiająca wejście na obrazie, sufiksy odczytane z
    prostej; bez całych etykiet sufiksy wokół wejścia); `anchoredScale` (ta sama pomyłka cyfry na wszystkich etykietach);
  - narzędzie: `findPositionTools` (pary pionowych krawędzi, poziome krawędzie domykające: przez całą szerokość,
    boki dochodzą do nich – albo słaby róg i krawędź kończy się na bokach; cięcie tylko przy krawędzi wykresu;
    drugi przebieg z krawędziami wykresu jako boki); wybór wg kosztu (wejście ↔ krawędź w środku, SL / cel ↔
    zewnętrzne krawędzie po stronie kierunku);
  - świece: `measureExcursions` – piksele „mocne” (kolor świecy, jasność ≥ 0,6 × palety – strefy w kolorze świecy są
    ciemniejsze) i „słabe” (`underFill`: świeca pod półprzezroczystym wypełnieniem albo rozmyta kompresją; różna od obu
    sąsiadów, nie linia boku narzędzia), bez linii poziomych i kresek 1 px; MAE ujemne (konwencja dziennika);
  - `analyzeTvScreenshot` = całość; `__debug` nie ma – narzędzia diagnostyczne trzymaj poza repo.
- Renderer: `lib/tvOcr.ts` (dekodowanie, OCR osi przez IPC `ocrImage`, `measureTv` – drugi TP gdy pierwszy nie pasuje),
  `features/trade/TvExcursions.tsx` (przycisk „Z TradingView”, okno z podglądem SVG, „Pomiń świecę wejścia”, CSV,
  `useAutoExcursions`: nowy screen „po” + puste MAE i MFE → odczyt w tle, ustawienie `screens.autoExcursions`).
- CSV: `shared/calc/excursions.ts` (`excursionsFromBars` od świecy wejścia do świecy wyjścia, te same zasady przycinania;
  `tradeLevels`: TP1 ?? TP2, ostatnie wyjście z czasem).
- Protokół `journal-file` ma `corsEnabled` i `Access-Control-Allow-Origin: *` (fetch z `file://`).
- Testy: `tests/unit/tv-chart.test.ts` (syntetyczne screeny `tests/fixtures/tv/` z `scripts/tv-screens.mjs` przez
  prawdziwy Tesseract w Node, `tests/unit/helpers/tvScreens.ts`), `tests/e2e/tv-excursions.spec.ts`. Nie commituj
  screenów użytkownika (repo publiczne). Pomiar przy rozwoju: 181/182 syntetycznych w tolerancji max(0,3 p, 1,5 px),
  9 prawdziwych screenów użytkownika spójnych z osią; ≈1,5 s na screen.

## Duplikowanie
- `src/shared/duplicate.ts`, akcje w `renderer/features/duplicate.ts`, Ctrl+Shift+D wg ekranu.
- Scenariusz prognozy: nowe `id` (także celów), nazwa „(kopia)”, „(kopia 2)”…, te same losowania; zapisany od razu.
- Transakcja / przykład z biblioteki: nowe `id` i czasy, screeny współdzielone (te same pliki).
- Plan dnia → inna data (domyślnie następny dzień handlowy, `shiftTradingDay`): pary (nowe id poziomów, bez screenów),
  intermarket i notatki; bez newsów, podsumowania i screenów. Istniejący plan w dniu docelowym nie jest nadpisywany.

## Aktualizacje (GitHub Releases)
- Części czyste: `src/shared/update.ts` (wersje semver, odpowiedź API, wybór pliku, SHA256SUMS, tryb instalacji).
- Proces main: `src/main/update/` (`updater.ts` stan/sprawdzanie/pobieranie, `download.ts`, `apply.ts`).
- Renderer: `store/update.ts`, `features/settings/UpdatesTab.tsx`, banery w `app/Banners.tsx`.
- Ustawienia per komputer: `config.json` → `updates {prefs, pending, lastRunVersion}`.
- Sprawdzanie `GET /repos/Clatir/TradingJournal/releases/latest` przez `net.fetch`: 15 s po starcie, potem co 6 h; 404 = brak wydań.
- Pobieranie w tle do `<exe portable>.update` albo `userData/updates/<Setup>.exe`, przez `.part`.
- Weryfikacja: SHA-256 z `SHA256SUMS.txt` i/lub `digest` z API (muszą się zgadzać); bez sumy – odmowa.
  Adresy tylko https (poza `ICTJ_UPDATE_URL`).
- Instalacja przy zamknięciu (`will-quit`, po zapisaniu danych); „Uruchom ponownie teraz” = `requestRestart()` + zwykłe zamknięcie okna.
- Portable: launcher NSIS trzyma swój exe otwarty, więc podmianę robi pomocnik PowerShell (`-EncodedCommand`).
  Pomocnik:
  1. czeka na PID aplikacji i launchera,
  2. przenosi exe → `.old` i `.update` → exe (przy błędzie przywraca stary, 120 prób co 0,5 s),
  3. opcjonalnie robi `Start-Process`, log w `logs/update.log`.

  Uruchamianie jest dwustopniowe: krótki potomny PowerShell (ukryta konsola, `spawnSync`) startuje pomocnika przez
  `Start-Process -WindowStyle Hidden`. Dwie rzeczy sprawdzone w CI:
  - PowerShell uruchomiony jako proces odłączony (`detached`, bez konsoli) w ogóle nie wykonuje skryptu;
  - zwykły proces potomny ginie razem z aplikacją (obiekt zadania libuv). „Wnuk” do tego zadania nie należy.
- Zainstalowana: `Setup.exe --updated /S [--force-run]` (odłączony), instaluje w folderze z rejestru.
- Restart (1.6.2): pomocnik pokazuje okienko stanu (WinForms, tylko gdy `restart`; wartości enum/kolorów jako tekst –
  literał typu, którego nie da się rozwiązać, zatrzymuje cały skrypt przed `try`) do pojawienia się okna nowej wersji
  (proces `appProcess` z `MainWindowHandle` i `StartTime` po starcie pomocnika; 180 s, potem komunikat „uruchom
  ręcznie”); w trybie instalatora osobny pomocnik `restartWatchScript`. Skrypt pomocnika idzie do pliku w `%TEMP%`,
  a polecenie to tylko loader (`helperBootstrap`: `[scriptblock]::Create`, bez polityki wykonywania) – skrypt
  zakodowany dwukrotnie przekraczał limit 32 767 znaków linii poleceń. Składnię skryptów można sprawdzić `pwsh`
  (`Parser::ParseFile`); CI na Windows sprawdza w `update.log` „new window after”.
- Tryb „ręczny” (dev, nie-Windows, `win-unpacked`): tylko informacja i link do wydania.
- Start: `lastRunVersion` < bieżąca → baner „Zaktualizowano” (opis z `pending`). Sprzątanie `.old`, `.update`, `.part`,
  `userData/updates`. Oczekująca aktualizacja innej kopii (portable vs zainstalowana) zostaje nietknięta.
- Wydanie: podbij `version` w package.json + sekcja `## X.Y.Z` w `CHANGELOG.md` (`scripts/release-notes.mjs`) → push.
  - CI (job `release`) publikuje `vX.Y.Z` z oboma exe i `SHA256SUMS.txt`, raz na wersję.
  - Wersja z `-` = pre-release (nie trafia do `releases/latest`).

## Konwencje kodu
- Tekst UI po polsku, terminy ICT po angielsku; komentarze w kodzie po angielsku.
- Liczby: `.num` (JetBrains Mono, cyfry tabelaryczne). Zieleń/czerwień (`text-up`/`text-down`) tylko dla wyniku.
  Jeden akcent `#e8a33d`. Bez gradientów i cieni; panele z nagłówkiem, linie 1 px, animacje 120–160 ms.
- Selektory zustand zwracają wartości prymitywne lub istniejące referencje (nowy obiekt w selektorze = pętla renderów).
- Walidator (`src/shared/calc/validator.ts`) nigdy nie blokuje zapisu – tylko flaguje. Zasady: SL ≤ próg, R:R do TP1,
  killzone, bias HTF (z sekcji pary w planie dnia, interwał w ustawieniach), SL poza płynnością (tak/nie/nie oceniono),
  dzień z newsami (tylko informacja). Ocena = spełnione / ocenialne; „zgodna” = brak złamanych.
- Szkic (nowy wpis) przestaje być szkicem przy pierwszej edycji – opuszczenie ekranu nigdy nie gubi zmian.
- Nazwy w ustawieniach (słowniki, killzone'y) i kody walut edytowane jako szkic, stosowane po wyjściu z pola
  (`NameInput`, `CurrencyInput`): można wyczyścić i wpisać od nowa, duplikat nazwy jest odrzucany z komunikatem.
- Limity dzienne liczone dla daty NY „dziś”: suma R zamkniętych i liczba transakcji (bez missed).
- Kursy przeliczeniowe kalkulatora: `settings.risk.conversionRates` (1 waluta kwotowana = x waluty konta).

## Etapy
1. ✅ Folder danych, transakcja, lista, screeny z kompresją, konflikty, build exe + CI.
2. ✅ Plan dnia + walidator + kalkulator pozycji + limity dzienne.
3. ✅ Analityka + dane przykładowe.
4. ✅ Biblioteka (adnotacje) + przegląd tygodnia (import OHLC CSV) + eksport/import/backup.
5. ✅ Szlif wizualny, lightbox porównawczy, ściąga skrótów (`?`/F1), Ctrl+S, folder kopii per komputer, finalny build 1.0.0.
6. ✅ 1.1.0: duplikowanie wpisów, aktualizacje z GitHub Releases (portable bez instalatora), wydania z CI.
7. ✅ 1.2.0: kalkulator zysku / straty (AUDUSD, EURGBP, EURUSD, EURAUD, WTI, instrument własny).
8. ✅ 1.2.1: przegląd opcji – poprawki kalkulatorów, waluty konta, kroku lota, słowników i killzone'ów (`tests/e2e/settings.spec.ts`).
9. ✅ 1.3.0: prognoza wypłat (scenariusze, cele, fundusz celowy, rozrzut, wykres, eksport CSV/XLSX), kursy NBP,
   lista instrumentów, TP i zysk do ryzyka w kalkulatorze pozycji (`tests/e2e/forecast.spec.ts`); kalkulatory w PLN,
   partiale, kurs z dnia transakcji, wynik z lotów, prognoza z wyników, raport miesięczny, import historii od brokera
   (`tests/e2e/journal-tools.spec.ts`).
10. ✅ 1.4.0: sesje analizy portfolio (stoper, decyzje, powody odrzucenia, pytanie o odrzucone, analityka i raport),
    dwa komputery naraz (scalanie / pytanie), historia zmian z przywracaniem, szablony planu dnia, samopoczucie, mapa
    godzin, trening na kartach, własne pola, kolumny i zapisane filtry (`tests/e2e/v14.spec.ts`).
11. ✅ 1.5.0: strona Raporty (okres, sekcje), PIT-38 orientacyjnie, cele i limity z pytaniem, porównanie okresów,
    PLN w rozbiciach i kalendarzu (`tests/e2e/v15.spec.ts`, `tests/unit/reports-goals.test.ts`); 1.5.1: kontynuacje
    (ponowne otwarcie, KZ z pierwszego wejścia do końca dnia NY, `tests/unit/continuation.test.ts`).
12. ✅ 1.6.0: MAE / MFE ze screena TradingView „po” (narzędzie Long / Short Position, OCR osi, autouzupełnianie)
    i dokładnie z CSV (`tests/unit/tv-chart.test.ts`, `tests/e2e/tv-excursions.spec.ts`).

## Weryfikacja wydajności (5000 transakcji, `tests/e2e/perf.spec.ts`)
Linux/Xvfb: start → lista ≈ 1,6–2,0 s (z uruchomieniem Electrona), 54 wiersze w DOM (wirtualizacja), wyszukiwanie ≈ 70 ms
(`useDeferredValue`), analityka ≈ 0,4–0,5 s. Wczytanie plików na NTFS w CI: ≈ 1,2 s.
