# ICT Trade Journal – ustalenia projektu

Osobisty dziennik day tradera forex (metodologia ICT). Aplikacja desktopowa Electron dla Windows, w pełni offline,
używana na kilku komputerach (nigdy jednocześnie). Interfejs po polsku, terminy ICT po angielsku.

## Stack
- Electron 44 + React 19 + TypeScript 6 (strict) + Vite 7 (`electron-vite` 5) + Tailwind 4.
- Zależności w czystym JS: zod 4 (schematy), zustand 5 (stan), luxon (strefy, DST), ulid, yazl/yauzl (ZIP),
  cmdk (paleta), @tanstack/react-virtual, lightweight-charts 5 (equity). Słupki i heatmapy: własne komponenty SVG.
- **Żadnych natywnych modułów Node.** Wszystkie biblioteki są w `devDependencies` i bundlowane do `out/`,
  więc `app.asar` nie zawiera `node_modules`.
- Testy: Vitest (`tests/unit`, `tests/fs`), Playwright `_electron` (`tests/e2e`, lokalnie pod `xvfb-run`).
- Build: electron-builder → `portable` + `nsis` (x64). CI: `.github/workflows/ci.yml` (Linux testy + build na Node
  22.12.0/24/26, blokada na 22.11, Windows build + smoke na Node 24).
- Node do budowania: ≥ 22.12 (Vite 7 / Vitest 5), zalecany 24 LTS. `package.json` nie ma `"type": "module"` (preload
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
node scripts/calibrate-webp.mjs [plik.png]   # kalibracja jakości WebP (CHROMIUM_PATH=... jeśli trzeba)
```
E2E przeciw spakowanej aplikacji: `ICTJ_E2E_EXECUTABLE=<ścieżka exe> npx playwright test`.
Zmienne testowe: `ICTJ_USER_DATA` (izolowany userData), `ICTJ_DATA_DIR` (folder danych bez okna wyboru),
`ICTJ_MACHINE_NAME`.

## Architektura
- `src/shared` – czyste TS używane przez main i renderer: `schema/` (zod = źródło typów), `calc/` (pipsy, R,
  statystyki, czas/killzone, pozycja), `migrations/`, `paths.ts` (układ folderu, nazwy, wzorce konfliktów),
  `records.ts` (parse/serialize), `api.ts` (kontrakt IPC).
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
  W folderze tylko do odczytu edycje nie są przyjmowane.

## Dane (folder wybierany przez użytkownika)
```
journal.json                         ustawienia, słowniki, schemaVersion
trades/RRRR/RRRR-MM-DD_PARA_ULID.json  data = data NY wejścia
days/RRRR/RRRR-MM-DD.json            plan dnia (sekcje per para)
weeks/RRRR-Wnn.json                  przegląd tygodnia (tydzień ISO)
library/ULID.json                    biblioteka setupów
screens/RRRR/MM/ULID_etykieta.webp  (+ .thumb.webp)
backups/                             kopie ZIP (wyłączone ze skanu)
.presence/                           heartbeat komputerów (ignorowany przez skan)
```
- JSON z wcięciami (2 spacje) i końcowym `\n`; czasy UTC ISO 8601; identyfikatory ULID; ścieżki **względne** z `/`.
- Każdy rekord: `schemaVersion`, `id`, `createdAt`, `updatedAt`. Nieznane pola są zachowywane (`z.looseObject`).
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
  Słupki/heatmapy: własne SVG (`components/charts`).
- Dane przykładowe: `src/shared/sample/generate.ts` (deterministyczne, ziarno 1234, 30 wpisów, 3 missed), screeny
  rysowane canvasem (`features/sample/drawChart.ts`). Folder `userData/sample-journal` – osobny od prawdziwych danych;
  `config.lastRealDir` pamięta prawdziwy folder. Status `isSample` → baner DEMO.

## Biblioteka, tydzień, eksport, kopie
- Adnotacje: wektorowo w `ScreenRef.annotations` (współrzędne 0–1), rysowane SVG nad obrazem (`components/annotations.tsx`);
  „Kopiuj z adnotacjami” spłaszcza przez canvas do schowka (IPC `copyImage`). Plik WebP nigdy nie jest modyfikowany.
- Biblioteka może współdzielić pliki screenów z transakcją; usunięcie wpisu kasuje tylko screeny bez innych odwołań.
- Przegląd tygodnia: tydzień ISO, dni pon–pt wg daty NY; import CSV z TradingView („Export chart data”, czas UNIX lub ISO,
  separator `,` lub `;`) → `src/shared/calc/ohlc.ts`.
- Eksport: CSV (`src/shared/export/csv.ts`), markdown (`export/markdown.ts`, Ctrl+Shift+M), ZIP folderu bez `backups/`.
- Import: folder lub ZIP (rozpakowanie bezpieczne – yauzl odrzuca `../`), walidacja każdego pliku bez zmian w danych,
  potem „scal” (polityka kolizji: nowsza / pomiń / nadpisz; słowniki i pary z importu dołączane) albo „otwórz jako osobny”.
- Kopie przy starcie (`main/datastore/backup.ts`): `backups/daily/RRRR-MM-DD_json.zip` (14), `backups/weekly/RRRR-Wnn_full.zip`
  gdy najnowsza ≥ 7 dni (4), ręczne `backups/manual/` (5), przed migracją `backups/pre-migration/`. Demo nie ma kopii.

## Konwencje kodu
- Tekst UI po polsku, terminy ICT po angielsku; komentarze w kodzie po angielsku.
- Liczby: `.num` (JetBrains Mono, cyfry tabelaryczne). Zieleń/czerwień (`text-up`/`text-down`) tylko dla wyniku.
  Jeden akcent `#e8a33d`. Bez gradientów i cieni; panele z nagłówkiem, linie 1 px, animacje 120–160 ms.
- Selektory zustand zwracają wartości prymitywne lub istniejące referencje (nowy obiekt w selektorze = pętla renderów).
- Walidator (`src/shared/calc/validator.ts`) nigdy nie blokuje zapisu – tylko flaguje. Zasady: SL ≤ próg, R:R do TP1,
  killzone, bias HTF (z sekcji pary w planie dnia, interwał w ustawieniach), SL poza płynnością (tak/nie/nie oceniono),
  dzień z newsami (tylko informacja). Ocena = spełnione / ocenialne; „zgodna” = brak złamanych.
- Szkic (nowy wpis) przestaje być szkicem przy pierwszej edycji – opuszczenie ekranu nigdy nie gubi zmian.
- Limity dzienne liczone dla daty NY „dziś”: suma R zamkniętych i liczba transakcji (bez missed).
- Kursy przeliczeniowe kalkulatora: `settings.risk.conversionRates` (1 waluta kwotowana = x waluty konta).

## Etapy
1. ✅ Folder danych, transakcja, lista, screeny z kompresją, konflikty, build exe + CI.
2. ✅ Plan dnia + walidator + kalkulator pozycji + limity dzienne.
3. ✅ Analityka + dane przykładowe.
4. ✅ Biblioteka (adnotacje) + przegląd tygodnia (import OHLC CSV) + eksport/import/backup.
5. ✅ Szlif wizualny, lightbox porównawczy, ściąga skrótów (`?`/F1), Ctrl+S, folder kopii per komputer, finalny build 1.0.0.

## Weryfikacja wydajności (5000 transakcji, `tests/e2e/perf.spec.ts`)
Linux/Xvfb: start → lista ≈ 1,6–2,0 s (z uruchomieniem Electrona), 54 wiersze w DOM (wirtualizacja), wyszukiwanie ≈ 70 ms
(`useDeferredValue`), analityka ≈ 0,4–0,5 s. Wczytanie plików na NTFS w CI: ≈ 1,2 s.
