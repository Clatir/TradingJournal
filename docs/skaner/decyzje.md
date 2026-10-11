# Skaner ICT – decyzje i założenia

Założenia przyjęte w trakcie pracy, gdy specyfikacja milczy albo nie da się jej wykonać dosłownie. Każdy wpis: data, etap,
decyzja, powód.

## Krok 1 (2026-10-10)

1. **Nazwa pliku specyfikacji.** W głównym folderze nie było `specyfikacja.md`; specyfikacją jest plik
   `Skaner ICT — prompt dla Claude Code.md` (wersja z commita `0134798`, z tabelą modeli „do resetu / po resecie”).
   Przeniesiony bez zmian treści do `docs/skaner/specyfikacja.md`.
2. **Gałąź.** Specyfikacja mówi o `feature/skaner-ict`, ale ta sesja ma przydzieloną gałąź
   `claude/quirky-bohr-o95s2l` i nie może pushować na inną bez zgody użytkownika. Krok 1 jest na
   `claude/quirky-bohr-o95s2l`. Do potwierdzenia przy kroku 2: zostać na niej albo założyć `feature/skaner-ict`.
3. **Plugin `eodhd-api`.** Polecenia `/plugin marketplace add` / `/plugin install` są interaktywne i nie da się ich
   wykonać z sesji w chmurze. Repozytorium `EodHistoricalData/eodhd-claude-skills` (commit `9839c79`, 2026-10-10)
   pobrane przez git do katalogu tymczasowego i czytane jako dokumentacja; nie jest częścią repozytorium dziennika.
   Fakty, które miały znaczenie, sprawdzone kluczem użytkownika (patrz `rozpoznanie.md`).
## Krok 2 (2026-10-10, plan do akceptacji)

5. **Wszystko z M1.** Gotowe świece 5m/1h z EODHD pochodzą z innego źródła (różnice ~3 p, błędne świece, brak dla
   złota), więc każdy wyższy interwał składa aplikacja z M1. Głębokość pierwszego pobrania: 14 → 120 → 400 dni 1m
   zamiast „1h z 3 lat” ze specyfikacji.
6. **Magazyn świec = własne pliki binarne** w `userData/scanner/` (bez SQLite: brak natywnych modułów, `sql.js`
   trzyma bazę w pamięci, `node:sqlite` niepewny w Electronie, SQL niepotrzebny).
7. **Pokrycie zamiast luk.** Magazyn zapisuje okresy z potwierdzonymi danymi; luka = godziny rynku poza pokryciem.
8. **Nowe kolekcje w folderze dziennika:** `signals/`, `replays/`, `biases/`, `events/`, `missed/` + `settings.scanner`
   w `journal.json`, `SCHEMA_VERSION` bez zmian. Sygnały z replay trafiają do rekordu przebiegu, nie do `signals/`.
9. **Silnik w wątkach procesu głównego** (live i replay osobno), renderer tylko wyświetla; sieć tylko w main (CSP).
10. **Przełączniki alertów per komputer** (`config.json`), reszta ustawień skanera wspólna – do potwierdzenia (pytanie 10).
11. **Bez osobnego procesu zbierającego** – zbieranie w tle przez zasobnik tej samej aplikacji (wariant B, sekcja 7 planu).
12. **Przeliczenie na PLN przez USD** (USDPLN + pary z USD) zamiast dodatkowych symboli w subskrypcji.
13. **Obligacje:** bias D automatycznie z serii dziennych (TYX jako odwrotność ZB, Bund `FGBLZ<m><r>.US` z rolowaniem),
    H4 ręcznie.
14. **Skrót zakładki `Ctrl+0`** (Ctrl+1…9 zajęte).

## Odpowiedzi użytkownika na pytania planu (2026-10-11)

Użytkownik przyjął wszystkie wartości domyślne z sekcji 12 planu:

1. XAUUSD: pips 0,1 USD, kontrakt 100 uncji, max SL = ułamek ADR20 jak 20 p dla EURUSD (dziś ≈ 26 USD/oz, wyliczany
   na bieżąco, widoczny i edytowalny). WTI: pips 0,01, 1 lot = 1000 baryłek, max SL tymczasowo 2% ceny do zebrania 20 dni.
2. Kapitał, ryzyko i krok lota z istniejących ustawień dziennika (`settings.risk`), waluta konta PLN.
3. Świece z ceny **bid** (ostatecznie po pomiarze w sesji w fazie 1).
4. WTI: wariant A (live `WTIUSD` + historia od włączenia + import CSV z TradingView). Kalendarz: Forex Factory + ręczne.
5. Zbieranie w tle przez zasobnik i start z systemem, jeśli REST okaże się nieświeży.
6. Test złoty: **brak dni** – czeka na wskazanie użytkownika (najpóźniej w fazie 3).
7. Powody ocen: zły bias, słaby displacement, mało istotna płynność, za późno w oknie, przeszkoda przed TP, SL za szeroki,
   za blisko newsów, zła strefa wejścia, inne (edytowalne).
8. **Gałąź: zostajemy na `claude/quirky-bohr-o95s2l`** (odstępstwo od `feature/skaner-ict` ze specyfikacji).
9. Skrót zakładki: `Ctrl+0`.
10. Przełączniki dźwięku i powiadomień per komputer.
11. Alerty przy niepełnej sesji działają z flagą „niepełne dane”.
12. Głębokość historii 1m: 400 dni dla instrumentów, 120 dni dla składników indeksów.
13. Obligacje: TYX (rentowność 30Y) jako odwrotność ZB, Bund tylko dziennie (`FGBLZ<m><r>.US`); H4 ręcznie.

Dodatkowa zasada od użytkownika: **przed każdą fazą podać szacowany czas czystej pracy Claude'a** (tabela w sekcji 6
planu, aktualizowana przed każdą fazą).

## Zmiana paradygmatu (2026-10-11, plan sekcja 14)

Po teście złotym (setupy H1 użytkownika) użytkownik zmienił założenia modeli: analiza top-down D → H4 → H1 → M15,
wejścia na H1 (główne) i M15 (doprecyzowane). Odpowiedzi:

1. Bias: H1 wymaga zgodnego D i H4, M15 dodatkowo H1; H1 pod bias = flaga „kontra”, bez alertu; M15 pod bias = brak
   sygnału. **Zgoda.**
2. Okna: „tylko podczas KZ London i NY” (02:00–04:40, 07:00–10:00 NY); klasyczne okna SB 10–11 i 14–15 odpadają
   **[założenie: SB tylko 03:00–04:00]**. Do potwierdzenia: wymóg okna dla powstania setupu (a) czy także dla wejścia (b);
   do decyzji domyślnie (a) dla H1, (b) dla M15.
3. Setup H1 nie wygasa z końcem okna (FVG zamknięty po drugiej stronie, zamknięcie za ekstremum sweepu, cel bez
   cofnięcia, zmiana biasu D/H4). **Zgoda.**
4. Maksymalny SL: **30 pipsów** (FX, H1 i M15). Złoto/ropa do potwierdzenia: skalowanie ADR (≈ 39 USD dziś) odrzuca
   Z1, Z3, Z4 z testu złotego; alternatywa osobna wartość (np. 65 USD).
5. Alerty H1 przy „uzbrojony” i „gotowy”, M15 przy „gotowy” – brak odpowiedzi, przyjęta propozycja.
6. Skaner ma własny preset złota (pips 0,1 USD, kontrakt 100 oz) – dziennik nie ma presetu XAUUSD.
7. **Doprecyzowanie okien (2026-10-11):** w KZ musi być tylko **wejście**; setup może powstać o dowolnej porze.
   Dotknięcie strefy poza KZ = znacznik „dotknięty poza KZ”, bez alertu, setup trwa **[założenie]**.
8. **Konwergencja PDA daje dodatkowe punkty**: +5 (2 PDA), +10 (3+), wynik obcinany do 100 **[założenie co do wartości]**.
9. **Maks. SL złota: 65 USD** (osobna wartość). Ropa: skalowanie ADR, tymczasowo 2% ceny.

## WTI (2026-10-11)

- **Historia WTI z eksportu CSV TradingView** („Export chart data”, H1, także 1m) – potwierdzone przez użytkownika –
  importowana do magazynu świec (faza 1) + bieżące ceny ze strumienia `WTIUSD`. Do ustalenia: symbol WTI w TradingView
  (spot/CFD vs futures CL1!) – zgodność ze strumieniem sprawdzana przy pierwszym imporcie.

## Faza 1 – dane i magazyn świec (2026-10-11)

1. **Konfigurację wysyła okno.** Renderer trzyma ustawienia dziennika, więc to on przekazuje `settings.scanner`
   i walutę konta do procesu głównego (`scanner:configure`, przy każdej zmianie); main niczego nie czyta z folderu.
2. **REST nadpisuje świecę ze strumienia z tej samej minuty** (dane sfinalizowane, zgodne z TradingView); import M1
   z CSV nie nadpisuje świec już zapisanych, import H1 z CSV leży osobno i wypełnia tylko godziny bez M1.
3. **Pokrycie (dane potwierdzone):** strumień – minuta, w której strumień był połączony i żywy (tick ≤ 90 s temu),
   tylko dla symboli z tickiem w ostatnich 30 min; REST – zakres zapytania, przy danych z ostatnich 3 dni tylko do
   ostatniej otrzymanej świecy (reszta zostaje luką do ponowienia), starszy pusty zakres = pokryty (np. przed
   początkiem historii) – bez ponawiania w nieskończoność.
4. **Backfill** etapami 14 → 120 → głębokość (400 dni instrumenty, 120 pozostałe), na starcie, po zmianie listy,
   po wybudzeniu komputera i co 15 min; przerywany przy braku klucza, odrzuconym kluczu, limicie dziennym i braku sieci.
5. **Błędne świece EODHD** (low < 0,8 × średniej z open/close albo high > 1,25 ×, puste pola) są odrzucane przy parsowaniu.
6. **Cisza strumienia:** w godzinach rynku brak żywego ticka przez 90 s → ponowne połączenie; próg podwaja się po
   każdej takiej próbie (do 30 min), żeby święta nie powodowały pętli. „Symbols limit reached” → ponowienie po 5 min.
7. **Zmiana bid ↔ mid** nie przelicza zapisanych świec (różnica ok. 0,1 p); dotyczy tylko nowych świec ze strumienia.
8. **Klucz API:** `EODHD_API_TOKEN` w środowisku ma pierwszeństwo (rozwój, testy); bez szyfrowania (`safeStorage`
   niedostępne) klucz tylko do zamknięcia aplikacji.
9. **Serie wyższych interwałów** liczone na żądanie z M1 (ok. 50 ms na interwał dla 400 dni jednego symbolu);
   osobny cache H1 (`h1.bin`) odłożony do fazy 2, jeśli silnik będzie go potrzebował.
10. **Zasobnik / zbieranie w tle** odłożone do pomiaru świeżości REST w sesji (plan sekcja 7: wariant A albo B).
11. **Syntetyczny DXY zweryfikowany:** wzór ICE na minutówkach EODHD vs `NYICDX.INDX` (1h, 122 pomiary 21.09–9.10):
    mediana różnicy 0,003%, maks. 0,13%, kierunek zmian godzinowych zgodny 94/105.
    **Syntetyczny EURX zweryfikowany** z eksportem użytkownika `PEPPERSTONE:EURX` (H1, 300 świec 22.09–9.10):
    stosunek stały 9,7544 (odch. 0,056%), po przeskalowaniu mediana różnicy 0,034% (maks. 0,13%), kierunek zmian
    godzinowych 252/258 (przy ruchach ≥ 0,5 pkt 75/75), korelacja 0,985. W fazie 3 EURX pokazywany w skali
    użytkownika: wynik wzoru ICE × 9,7544 (parametr `synthetic.eurxScale`, edytowalny).
12. Wykres fazy 1: lightweight-charts nie pokazuje pustego czasu, więc luka = znacznik „luka X h” na pierwszej świecy
    po niej, świece zachodzące na lukę przyciemnione.
13. Zależność deweloperska `ws` (serwer WebSocket w testach, `tests/helpers/fakeEodhd.ts`); aplikacja używa
    wbudowanego `WebSocket` Node.

## Krok 1 – c.d.

4. **Bezpieczeństwo klucza.** Skrypty testowe czytają `EODHD_API_TOKEN` ze zmiennej środowiskowej, maskują go w każdym
   wypisie i leżą poza repozytorium. Z User API zapisywane są tylko pola techniczne (bez imienia i e-maila).
