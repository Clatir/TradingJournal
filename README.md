# ICT Trade Journal

Osobisty dziennik day tradera forex w metodologii ICT – aplikacja desktopowa dla Windows, działa offline. Łączy się z siecią
tylko po aktualizacje (GitHub) i kursy walut (tabela A NBP); jedno i drugie można wyłączyć w ustawieniach, a aplikacja
niczego nie wysyła.
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

**Wersja 1.2 – kalkulator zysku / straty**
1. `Ctrl+6` → „Kalkulator zysku / straty”: wybierz instrument, wpisz loty i pipsy, przełącz Zysk / Strata
   (albo wpisz ujemne pipsy).
2. EURUSD/AUDUSD: 0.5 lota × 20 pipsów = 100 USD.
3. EURGBP/EURAUD: wpisz kurs GBP→USD / AUD→USD (wspólny z kalkulatorem pozycji).
4. WTI: 1 lot × 30 pipsów = 300 USD (1 lot = 1000 baryłek). Inny kontrakt u brokera → wpisz własną wartość pipsa,
   „przywróć wyliczoną” wraca do domyślnej.
5. „Własny”: nazwa, najmniejszy lot i wartość pipsa dla najmniejszego lota (z platformy brokera) – zapamiętywane.

**Wersja 1.3 – prognoza wypłat, kursy NBP, instrumenty**
1. `Ctrl+7` → „Utwórz pierwszy scenariusz”. Ustaw zwrot stały 11%, wypłatę 10%, kapitał 10 000, dopłatę 2 000, pierwszy
   miesiąc listopad 2026, 50 miesięcy, trzy cele (miesiące 6, 12, 19), tryb „Gotówka” – cele dostają 1 223.50 / 3 171.61 /
   8 198.92, kapitał na koniec 3 365 620.22. „Fundusz celowy” – wyższe kwoty i „w gotówce: …” przy celach.
2. Suwak, pole i szybki wybór wypłaty; w kolumnie „Wpłata” wpisz kwotę (także ujemną) – fokus zostaje, Enter przechodzi niżej.
3. Cel z kwotą (np. 2 000) – „Kupiony w mies. 8 (6-2027), 2 mies. po planie”; „może poczekać” przy dużej kwocie.
4. Miesiące stratne, zwrot losowy („Losuj ponownie”), podatek roczny, podsumowania lat (klik w wiersz roku zwija miesiące).
5. Tryb pipsowy: instrument, pipsy stałe lub losowe, lot stały / na kwotę kapitału / z ryzyka; kurs z NBP albo wpisany ręcznie.
6. Pasek scenariusza: „Nowy”, „Duplikuj” (`Ctrl+Shift+D`), zmiana nazwy, „Porównaj z…”, „Usuń”. Plik `forecasts/<id>.json`
   pojawia się i znika w folderze danych.
7. „Rozrzut wyników” (200 / 1000 / 5000 przebiegów) i wykres z „Pokaż rozrzut”; „Kopiuj tabelę”, „CSV”, „XLSX” – otwórz w Excelu.
8. Ustawienia → Wyświetlanie i ryzyko → „Kursy walut”: „Odśwież kursy NBP” (bez internetu zostaje ostatnia tabela),
   kursy wpisane ręcznie. Ustawienia → Instrumenty: dodaj instrument, zarchiwizuj, „Przywróć domyślne”.
9. Kalkulator pozycji: pole „TP (pips)” – zysk przy TP i zysk do ryzyka (1 : 2.00). Kwoty kalkulatorów są w PLN
   (waluta obok „Kapitał”), także przy koncie w USD; „Wartość pipsa / 1 lot” pokazuje kurs i datę tabeli NBP.
   Panel „Partiale”: 1 lot, SL 20, wynik teraz +30, połowa teraz i połowa na +60 → zamknięcie teraz +300, podział
   najlepiej +450, najgorzej +50 (z SL na BE +150); dodaj do 4 części.
10. Ten sam folder na drugim komputerze: scenariusz pokazuje identyczne liczby (losowania są zapisane w pliku).
11. `Ctrl+3` → pasek „Raport miesięczny” pod wskaźnikami: wybierz miesiąc – wynik w R i w PLN (kursy NBP z dnia przed
    zamknięciem), „Kopiuj markdown”, „Zapisz .md”, „Zapisz PDF” (tygodnie, pary, najczęstsze błędy, zgodność z zasadami,
    plan dnia). Raport obejmuje cały miesiąc i wszystkie pary, niezależnie od filtrów analityki.
12. Ustawienia → Eksport, import, kopie → „Import historii od brokera”: MetaTrader – w terminalu Historia → prawy przycisk
    → „Zapisz jako raport” (HTML); XTB – xStation → Historia → eksport XLSX. Sprawdź strefę czasu pliku (serwer MT =
    NY + 7 h, XTB = Warszawa) i tolerancję, „Zastosuj” – dopasowane wpisy dostają loty, wyjścia i wynik netto, a numer
    pozycji widać w edytorze transakcji. Ponowny import tego samego pliku pokazuje „już zaimportowana”.

**Wersja 1.4 – analiza portfolio, dwa komputery, trening**
1. Górny pasek → „Analiza” (albo `Ctrl+Shift+A`): wybierz pary, „Start”, zaznaczaj parę, którą właśnie analizujesz,
   „Zakończ i zdecyduj” – dla każdej pary handluję / obserwuję / odrzucam z powodami. Odrzucone pary wrócą jako pytanie
   „Pytania: 1” po kilku godzinach. Analityka → „Czas analizy i selekcja par”; raport miesięczny ma tę samą sekcję.
2. Ten sam folder otwarty na dwóch komputerach: zmień na jednym transakcję, którą drugi właśnie edytuje – drugi scala
   zmiany albo pyta o pola zmienione po obu stronach (przycisk „Zmiany z drugiego komputera” w górnym pasku).
   Ustawienia → Folder danych → „Praca na dwóch komputerach”: „Scalaj zmiany, pytaj tylko przy konflikcie” albo
   „Zawsze pytaj przed przyjęciem zmian”.
3. „Historia” w transakcji: poprzednia wersja z różnicami → „Przywróć”. Synchronizacja → „Usunięte wpisy” → przywróć.
4. Plan dnia → „Szablon ▾” → zapisz plan jako szablon, ustaw ★ domyślny; nowy plan innego dnia startuje z szablonu.
5. Rano pasek „Jak się dziś czujesz?” (sen, energia, stres) albo te same pola w planie dnia → Analityka „Samopoczucie a wynik”.
6. Analityka → „Mapa godzin”: przełącz Σ R / Śr. R / Win rate / Liczba / Błędy, najedź na pole.
7. `Ctrl+8` „Trening”: transakcje ze screenem „przed”, odpowiedz L / S / N, Enter – następna karta; trafność w czasie.
8. Ustawienia → Słowniki → „Własne pola transakcji”: dodaj „Ocena setupu” (lista A+/A/B), ustaw w transakcji, w dzienniku
   „Kolumny” → pokaż pole, „Filtry” → wybierz A+, „Zapisane ▾” → zapisz filtr; Analityka → „Własne pole: Ocena setupu”.
9. `Ctrl+6` → „Partiale”: 1 lot, SL 20, wynik teraz +30, połowa teraz i połowa na +60 – przy szansie 100% sugestia
   „Bardziej opłacalny: podział…” (oczekiwany +450 vs +300 teraz); szansa 50% → oczekiwany +250, sugestia „zamknięcie
   całości teraz”.
10. Ten sam panel „Partiale”: ramka „Całość na ostatnim celu (+60 pips)” – cała pozycja tam +600, „Na partialach tracisz
    wtedy 150.00 USD (0.75R)”, kolumna „vs TP” przy każdej części; przy szansie 50% trzymanie całości daje oczekiwany
    +200, podział o 50 więcej.
11. „Partiale” → „Optymalny podział”: 1 lot, SL 20, teraz +30, cel +60 z szansą 70% – najwyższy oczekiwany wynik:
    całość na +60 (+360); „Bez straty”: 40% teraz / 60% na +60 (+336, najgorszy 0); „Strata najwyżej 0.5 R”: 20% / 80%
    (+348). Przy każdym wyniku koszt względem całości na ostatnim celu (np. „Bez straty”: 120.00 USD, 0.60R).
    „Zastosuj ten podział” wpisuje go do kalkulatora.
12. Ustawienia → Pary: dodaj „OILWTI” – pips 0.01, 2 miejsca, 1 lot = 1000; transakcja short 90.37 → 86.83 z SL 90.84
    ma 354 pipsy wyniku i 47 pipsów SL. „Maks. SL (p)” = 60 → walidator „SL 47.0 p ≤ 60 p (limit OILWTI)”. Kalkulator
    pozycji: 10 000 USD, 1%, SL 47 → 0.21 lota.
13. Transakcja → „Ze screenu XTB”: w XTB otwórz pozycję z historii („Szczegóły pozycji”), zrób screen (Win+Shift+S) i
    wklej `Ctrl+V` w oknie (albo przeciągnij / wybierz plik). Po 1–3 s: kierunek, czas wejścia (WAW), ceny, SL, TP, loty,
    wyjście i wynik netto w walucie konta – popraw, odznacz, „Uzupełnij transakcję”. W folderze `screens/` nic nie
    przybywa. W „Wyjście i partiale” czas wyjścia jest w NY i w WAW – wpisz godzinę z XTB w kolumnie „Czas WAW”.
14. To samo ze screenem indeksu lub surowca (US500, DE40, OIL.WTI): para dopasowana mimo zniekształconej nazwy
    („odczytano „USS00” – dopasowano”); instrumentu spoza par – „Dodaj do par” w oknie. Pola z rozbieżnymi odczytami
    mają „sprawdź – inny odczyt”, a wynik niezgodny z cenami i wolumenem – ostrzeżenie pod tabelą.
15. Dziennik → „Kolumny” → „Kwota”: kwoty włączają się same, kolumna staje obok R. Transakcja z wpisanym wynikiem
    albo lotami – kwota; z samym ryzykiem % (saldo konta wpisane w kalkulatorze) – „≈” szacunek; bez danych – „—”
    z podpowiedzią po najechaniu. Pasek nad tabelą: „Σ kwota”. Ctrl+$ ukrywa kwoty, klik w „Kwota •••” je pokazuje.
16. `Ctrl+3` → „Krzywa zarobków (PLN) i drawdown” pod krzywą w R: transakcje z kwotą w PLN, w USD (kurs NBP z dnia
    przed zamknięciem albo dzisiejszy) i z samym ryzykiem % („≈”, pole „Szacuj transakcje bez kwoty”); obok wynik,
    max drawdown, najlepsza / najgorsza i „Transakcje w krzywej: N z M”.
17. Ikona „Raporty” na pasku po lewej (`Ctrl+9`): okres „Rok” → 2026, „wszystkie” sekcje – w podglądzie porównanie
    z 2025 i „PIT-38 – zestawienie orientacyjne” (przychód, koszty, miesiące, transakcje z kursem NBP). Odznacz
    sekcję – znika z podglądu i z PDF / markdownu. Kwartał i własne daty działają tak samo.
18. `Ctrl+6` → „Limity i cele”: cel tygodniowy 3R i limit dzienny 1,5% – w pasku u góry „tydz. …/3R” i „…%/−1.5%”.
    Po przekroczeniu limitu `Ctrl+N` pyta „Kończę na dziś” / „Mimo to dodaj transakcję”; po odznaczeniu „Po przekroczeniu limitu
    pytaj…” zostaje samo ostrzeżenie.
19. `Ctrl+3` z widocznymi kwotami: kolumna PLN w rozbiciach (pary, sesje, dni tygodnia…), kalendarz R / PLN, sekcja
    „Porównanie okresów” (tydzień / miesiąc / kwartał / rok / własne) z wynikiem w PLN.
20. Zamknięta transakcja → „↻ Otwórz ponownie”: nowy wpis z tą samą parą, kierunkiem, SL i celami; w Walidatorze
    „Wejście w killzone: kontynuacja wejścia z …”. Zmień datę wejścia na następny dzień – „Nie liczy się jako
    kontynuacja” i zasada złamana. Transakcja dodana ręcznie po zamknięciu innej (ta sama para i kierunek, ten sam
    dzień NY) – podpowiedź „to jej ponowne otwarcie?”. W dzienniku ↻, w Analityce tabela „Ponowne otwarcia”.
