# ICT Trade Journal

Osobisty dziennik day tradera forex w metodologii ICT – aplikacja desktopowa dla Windows, działa w pełni offline.
Dane to zwykły folder z plikami JSON i WebP (może leżeć w OneDrive albo na pendrive).

## Zbudowanie pliku .exe na Windows

Wymagania: [Node.js](https://nodejs.org/) **24 LTS** (minimum 22.12) i [Git](https://git-scm.com/). Visual Studio Build Tools
**nie są potrzebne** (aplikacja nie używa natywnych modułów). Sprawdź wersję poleceniem `node -v`. Aktualizacja: instalator
LTS z nodejs.org albo `winget install OpenJS.NodeJS.LTS`, potem nowe okno terminala.

```powershell
node -v
git clone https://github.com/Clatir/TradingJournal.git
cd TradingJournal
git checkout claude/ict-trade-journal-app-9fp4r4
npm ci
npm test
npm run dist:win
```

Wynik w folderze `release\`:

| Plik | Opis |
| --- | --- |
| `ICT-Trade-Journal-<wersja>-portable.exe` | jeden plik, bez instalacji – można trzymać np. na pendrive |
| `ICT-Trade-Journal-Setup-<wersja>.exe` | instalator (wybór folderu, skróty w menu Start i na pulpicie) |

- Pliki nie są podpisane cyfrowo, więc przy pierwszym uruchomieniu SmartScreen pokaże ostrzeżenie:
  **Więcej informacji → Uruchom mimo to**.
- Wersja portable przy każdym starcie rozpakowuje się do folderu tymczasowego, dlatego startuje kilka sekund dłużej.
- Gotowe pliki .exe buduje też GitHub Actions przy każdym pushu (zakładka **Actions** → ostatni przebieg → **Artifacts**,
  tam też zrzuty ekranu z testów na Windows).

Masz już sklonowane repozytorium? Pobierz zmiany i zainstaluj zależności od nowa:

```powershell
cd TradingJournal
git pull
npm ci
npm test
npm run dist:win
```

**Błąd `ERR_REQUIRE_ESM` … `std-env` przy `npm test`** – występował w starszej wersji repozytorium na Node starszym niż 22.12.
Rozwiązanie: `git pull` i `npm ci` (konfiguracje są teraz modułami ES `.mts`), a najlepiej też aktualizacja Node do 24 LTS.
Na zbyt starym Node `npm test` i `npm run build` wypisują ostrzeżenie z instrukcją.

Tryb deweloperski: `npm ci` i `npm run dev`. Testy: `npm test` (jednostkowe i na plikach), `npm run build` + `npx playwright test` (E2E).

## Dane

Przy pierwszym uruchomieniu wybierasz folder dziennika (np. `OneDrive\Dziennik ICT`). Na kolejnym komputerze wskazujesz
ten sam folder. Ustawienie folderu jest zapamiętywane osobno na każdym komputerze
(`%APPDATA%\ICT Trade Journal\config.json`, logi w `logs\main.log`).

Wskazówka dla OneDrive: kliknij folder dziennika prawym przyciskiem → **Zawsze zachowuj na tym urządzeniu**, żeby pliki
nie były pobierane dopiero przy otwieraniu. Kopie zapasowe mogą trafiać do folderu lokalnego (Ustawienia → Eksport, import, kopie).

Szczegóły formatu danych i decyzji projektowych: [CLAUDE.md](CLAUDE.md).

## Co przetestować (po etapach)

**Etap 1 – folder danych, transakcje, screeny**
1. Pierwsze uruchomienie: „Nowy dziennik” w pustym folderze (np. w OneDrive) – powstaje `journal.json` i podfoldery.
2. `Ctrl+N`: wpisz czas w NY lub w Warszawie (drugie pole przelicza się samo), sprawdź wykrytą killzone,
   ceny (przecinek lub kropka), szybkie wyjście TP1/SL/BE, partiale. Plik w `trades/RRRR/` jest czytelny w Notatniku.
3. Zrób screen w TradingView (Win+Shift+S), kliknij strefę „Przed” i `Ctrl+V` – zobaczysz „PNG … → WebP … ”. Klawisze 1–7
   nadają interwał. Kliknij miniaturę – pełny obraz z zoomem (kółko) i 100% (klawisz 1): sprawdź ostrość cyfr na osi.
4. Edytuj plik transakcji w Notatniku przy otwartej aplikacji – widok odświeży się sam. Skopiuj plik jako
   `…-LAPTOP.json` – pojawi się konflikt do rozstrzygnięcia (pasek u góry → Rozstrzygnij). Uszkodź JSON – trafi na listę problemów.
5. Ustawienia → Screeny: łączny rozmiar folderu, osierocone pliki.

**Etap 2 – plan dnia, walidator, kalkulator**
1. `Ctrl+D`: plan dnia – bias W/D/H4/H1, DOL, poziomy, scenariusze, DXY/EURX/FGBL/ZB, newsy, „po sesji”.
2. Nowa transakcja przejmuje kierunek z biasu D. Panel „Walidator zasad”: SL > 20 p, R:R < 2, poza killzone, przeciw biasowi.
   Ustawienia → Zasady: zmień progi i obserwuj ocenę. Kolumna „Zas.” w dzienniku.
3. „Przelicz loty” w transakcji → kalkulator (kurs przeliczeniowy dla par z inną walutą) → „Zastosuj do transakcji”.
4. Limity dzienne w górnym pasku („dziś”) i ostrzeżenie przy nowej transakcji po przekroczeniu.

**Etap 3 – analityka**
1. Ustawienia → Folder danych → „Włącz dane przykładowe” (osobny folder, baner DEMO) → `Ctrl+3`.
2. Filtry dat i par, krzywa equity z drawdownem, rozbicia, macierz zgodność × wynik, koszt tagów błędów, kalendarz
   (klik w dzień otwiera plan). „Wróć do moich danych” przywraca Twój folder.

**Etap 4 – biblioteka, tydzień, eksport, kopie**
1. W transakcji „Do biblioteki” → `Ctrl+4`; na screenie ✎ – strzałka, strefa, poziom, tekst; „Kopiuj z adnotacjami” i wklej w czat.
2. `Ctrl+5`: przegląd tygodnia; TradingView → menu wykresu → **Export chart data…** (M5–M15) → „Import CSV z TradingView”.
3. „MD” w transakcji / planie dnia (`Ctrl+Shift+M`) – markdown w schowku.
4. Ustawienia → Eksport, import, kopie: CSV otwórz w Excelu (polskie znaki, liczby z przecinkiem), ZIP, import ZIP-a
   z raportem, lista kopii (dzienna JSON przy starcie, tygodniowa pełna).

**Etap 5 – szlif i build**
1. `?` – ściąga skrótów. W podglądzie screena „Porównaj” (lub C) – przed/po obok siebie ze wspólnym zoomem.
2. Zbuduj `npm run dist:win`, uruchom wersję portable z pendrive'a i instalator; wskaż ten sam folder danych na dwóch komputerach.
