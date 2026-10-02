# ICT Trade Journal

Osobisty dziennik day tradera forex w metodologii ICT – aplikacja desktopowa dla Windows, działa w pełni offline.
Dane to zwykły folder z plikami JSON i WebP (może leżeć w OneDrive albo na pendrive).

## Pobranie gotowej aplikacji

Gotowe pliki są w [Releases](https://github.com/Clatir/TradingJournal/releases/latest):

| Plik | Opis |
| --- | --- |
| [`ICT-Trade-Journal-portable.exe`](https://github.com/Clatir/TradingJournal/releases/latest/download/ICT-Trade-Journal-portable.exe) | jeden plik, bez instalacji – można trzymać np. na pendrive |
| [`ICT-Trade-Journal-Setup.exe`](https://github.com/Clatir/TradingJournal/releases/latest/download/ICT-Trade-Journal-Setup.exe) | instalator (wybór folderu, skróty w menu Start i na pulpicie) |

Pliki nie są podpisane cyfrowo, więc przy pierwszym uruchomieniu SmartScreen pokaże ostrzeżenie:
**Więcej informacji → Uruchom mimo to**. Wersja portable przy każdym starcie rozpakowuje się do folderu tymczasowego,
dlatego startuje kilka sekund dłużej.

## Aktualizacje

Od wersji 1.1.0 aplikacja aktualizuje się sama z GitHub Releases:

1. Przy starcie (po ~15 s) i co 6 godzin sprawdza, czy jest nowsze wydanie (`api.github.com`, bez wysyłania jakichkolwiek danych).
2. Nową wersję pobiera w tle i sprawdza sumą SHA-256 opublikowaną w wydaniu. Plik z inną sumą jest odrzucany.
3. Instaluje ją **przy zamknięciu aplikacji**, bez klikania w instalator. Pasek u góry ma też przycisk **Uruchom ponownie teraz**.
   - **Portable:** nowy plik `.exe` zastępuje stary w tym samym miejscu, więc skróty dalej działają. Podmianę robi mały skrypt
     PowerShell po zamknięciu aplikacji (log: `%APPDATA%\ICT Trade Journal\logs\update.log`). Folder z plikiem `.exe` musi być
     zapisywalny. Na pendrive każdy komputer pobiera i podmienia ten sam plik.
   - **Zainstalowana:** instalator działa w tle (`/S`) w dotychczasowym folderze. Ustawienia, folder danych i kopie zostają.
4. Po aktualizacji pojawia się „Zaktualizowano do wersji …” z opisem zmian.

Dane dziennika nie są przy tym ruszane. Gdy nowa wersja zmienia format, sama migruje folder po kopii zapasowej.

**Ustawienia → Aktualizacje:**
- „Sprawdź teraz”;
- opis zmian;
- przełączniki: automatyczne sprawdzanie, pobieranie w tle.

Bez internetu aplikacja działa normalnie i sprawdzi ponownie później.

Wersja 1.0.0 nie miała aktualizacji: raz pobierz 1.1.0 ręcznie (link wyżej) i zastąp nią starą, dalej pójdzie samo.
Kopia zbudowana lokalnie z folderu `release\win-unpacked` tylko informuje o nowej wersji (nie wie, jak się podmienić).

### Wydanie nowej wersji

1. Podbij `"version"` w `package.json` (np. `1.1.0` → `1.2.0`, poprawki: `1.1.1`).
2. Dopisz w `CHANGELOG.md` sekcję `## 1.2.0` – to opis wydania, który aplikacja pokaże w „Co nowego”.
3. Commit i push na domyślną gałąź.

CI buduje oba pliki `.exe`, testuje je na Windows – także aktualizację do kolejnej wersji, portable i zainstalowanej. Potem
publikuje wydanie `v1.2.0` z `ICT-Trade-Journal-portable.exe`, `ICT-Trade-Journal-Setup.exe` i `SHA256SUMS.txt`.
Push bez zmiany wersji niczego nie publikuje. Wersja z myślnikiem (`1.2.0-beta.1`) to pre-release, którego aplikacja nie pobiera.

## Zbudowanie pliku .exe na Windows

Wymagany jest tylko [Git](https://git-scm.com/). **Wersja Node.js zainstalowana na komputerze nie ma znaczenia** (może być
stara albo żadna): skrypt `build-windows.cmd` pobiera jednorazowo Node.js w wersji z pliku `.node-version` (24 LTS) do folderu
`.tools\` w projekcie – ze sprawdzeniem sumy SHA-256 z nodejs.org – i używa go wyłącznie do budowania. Ustawienia systemu,
PATH ani Twój Node.js nie są zmieniane, uprawnienia administratora nie są potrzebne. Visual Studio Build Tools też nie
(aplikacja nie używa natywnych modułów).

```powershell
git clone https://github.com/Clatir/TradingJournal.git
cd TradingJournal
git checkout claude/ict-trade-journal-app-9fp4r4
.\build-windows.cmd
```

Skrypt kolejno: pobiera Node.js (tylko za pierwszym razem), `npm ci`, `npm test`, `npm run dist:win`. Można go też uruchomić
dwuklikiem w Eksploratorze. `.\build-windows.cmd -SkipTests` pomija testy. Masz już sklonowane repozytorium? `git pull`
i ponownie `.\build-windows.cmd`.

Wynik w folderze `release\`: `ICT-Trade-Journal-portable.exe` i `ICT-Trade-Journal-Setup.exe` (jak w wydaniach).
Gotowe pliki .exe buduje też GitHub Actions przy każdym pushu (zakładka **Actions** → ostatni przebieg → **Artifacts**, tam też
zrzuty ekranu z testów na Windows).

**Bez skryptu** (własny Node.js **22.12 lub nowszy**, zalecany 24 LTS – sprawdź `node -v`):

```powershell
npm ci
npm test
npm run dist:win
```

Na starszym Node.js `npm ci`, `npm test`, `npm run dev` i `npm run dist:win` zatrzymują się z instrukcją (zamiast błędów
`ERR_REQUIRE_ESM` czy „Electron failed to install correctly”) – wtedy użyj `build-windows.cmd` albo zaktualizuj Node.js
(`winget install OpenJS.NodeJS.LTS`, nvm-windows: `nvm install 24`, `nvm use 24`). Ostrzeżenia `npm warn deprecated …`
przy `npm ci` to nie błędy: pochodzą z wewnętrznych zależności electron-buildera (instalator Squirrel, pobieranie Electrona
przez proxy), których ta aplikacja nie używa.

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

**Wersja 1.1 – duplikowanie i aktualizacje**
1. W transakcji „Duplikuj” (albo `Ctrl+Shift+D`, albo przycisk w podglądzie dziennika) – kopia otwiera się od razu do edycji.
   Tak samo przykład w bibliotece.
2. W planie dnia „Kopiuj na…” – bias, poziomy i scenariusze na wybrany dzień (domyślnie następny dzień handlowy).
   `Ctrl+Shift+D` w planie kopiuje na następny dzień.
3. Ustawienia → Aktualizacje: wersja, tryb (portable / zainstalowana), „Sprawdź teraz”. Po wydaniu kolejnej wersji pojawi się
   pasek „Wersja … jest pobrana” → **Uruchom ponownie teraz**.
