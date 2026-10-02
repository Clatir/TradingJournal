# ICT Trade Journal

Osobisty dziennik day tradera forex w metodologii ICT – aplikacja desktopowa dla Windows, działa w pełni offline.
Dane to zwykły folder z plikami JSON i WebP (może leżeć w OneDrive albo na pendrive).

## Zbudowanie pliku .exe na Windows

Wymagania: [Node.js 22 LTS](https://nodejs.org/) i [Git](https://git-scm.com/). Visual Studio Build Tools **nie są potrzebne**
(aplikacja nie używa natywnych modułów).

```powershell
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
- Gotowe pliki .exe buduje też GitHub Actions przy każdym pushu (zakładka **Actions** → ostatni przebieg → **Artifacts**).

## Uruchomienie w trybie deweloperskim

```powershell
npm ci
npm run dev
```

## Dane

Przy pierwszym uruchomieniu wybierasz folder dziennika (np. `OneDrive\Dziennik ICT`). Na kolejnym komputerze wskazujesz
ten sam folder. Ustawienie folderu jest zapamiętywane osobno na każdym komputerze
(`%APPDATA%\ICT Trade Journal\config.json`, logi w `logs\main.log`).

Wskazówka dla OneDrive: kliknij folder dziennika prawym przyciskiem → **Zawsze zachowuj na tym urządzeniu**, żeby pliki
nie były pobierane dopiero przy otwieraniu.

Szczegóły formatu danych i decyzji projektowych: [CLAUDE.md](CLAUDE.md).
