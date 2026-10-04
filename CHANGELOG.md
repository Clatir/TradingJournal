# Historia zmian

Każda sekcja `## X.Y.Z` jest opisem wydania na GitHubie (CI publikuje je samo po podbiciu wersji w `package.json`),
a aplikacja pokazuje go w „Ustawienia → Aktualizacje” i po aktualizacji.

## 1.2.0

### Nowe
- **Kalkulator zysku / straty** (Kalkulator, Ctrl+6, albo paleta Ctrl+K → „Kalkulator zysku / straty”): wynik pozycji z wielkości w lotach, liczby pipsów i wartości pipsa dla najmniejszego lota.
  - AUDUSD, EURGBP, EURUSD, EURAUD: wartość pipsa wyliczana sama (0.10 USD za pips przy 0.01 lota). Dla EURGBP i EURAUD według kursu GBP / AUD, wspólnego z kalkulatorem pozycji.
  - WTI: 1 lot = 1000 baryłek, 1 pips = 0.01 USD. Jeśli u Twojego brokera jest inaczej, wpisz własną wartość pipsa.
  - Instrument własny: nazwa, najmniejszy lot i wartość pipsa dla najmniejszego lota.
- Wynik pokazuje kwotę zysku lub straty, wartość pipsa dla całej pozycji i dla 1 lota oraz wynik względem kapitału.
- Wartości wpisane ręcznie zapisują się w ustawieniach dziennika, więc są takie same na każdym komputerze.

## 1.1.0

### Nowe
- **Aktualizacje z GitHuba.** Aplikacja sama sprawdza nowe wydania (przy starcie i co 6 godzin), pobiera je w tle i instaluje przy zamknięciu, bez klikania w instalator:
  - wersja portable: nowy plik .exe zastępuje stary w tym samym miejscu (skróty dalej działają),
  - wersja zainstalowana: instalator działa w tle, bez okien, w dotychczasowym folderze.
- Pobrany plik jest sprawdzany sumą SHA-256 z wydania. Przycisk „Uruchom ponownie teraz” od razu instaluje i uruchamia nową wersję. Ustawienia są w zakładce „Ustawienia → Aktualizacje”.
- **Duplikowanie wpisów** (Ctrl+Shift+D albo przycisk „Duplikuj”):
  - transakcja: kopia ze wszystkimi polami i screenami,
  - przykład z biblioteki,
  - plan dnia na wybrany dzień (domyślnie następny dzień handlowy): bias, poziomy i scenariusze, bez newsów i podsumowania sesji.

### Poprawki
- Nieudany zapis (zablokowany plik, odłączony dysk) jest ponawiany automatycznie. Zamknięcie okna pyta, gdy coś zostało niezapisane.
- Można uruchomić tylko jedno okno aplikacji – drugie uruchomienie pokazuje istniejące.
- Uszkodzony plik w miejscu zapisu nie jest nadpisywany: zostaje odsunięty jako kopia konfliktu.
- Zmiana folderu danych zamyka bieżący dopiero po udanym otwarciu nowego.
- Niedostępny folder danych przy starcie (np. odłączony pendrive) – komunikat i „Spróbuj ponownie”.
- Drobne poprawki edycji:
  - adnotacje,
  - pola dat i walut,
  - kalkulator lotów na nowej transakcji,
  - eksport CSV i markdown.
- Budowanie exe na Windows niezależne od zainstalowanego Node.js (`build-windows.cmd`).

## 1.0.0

Pierwsza wersja:
- dziennik transakcji ICT ze screenami WebP i lightboxem,
- plan dnia z walidatorem zasad,
- kalkulator pozycji i limity dzienne,
- analityka: equity, drawdown, rozbicia, koszt błędów, missed trades,
- biblioteka setupów z adnotacjami,
- przegląd tygodnia z importem OHLC z TradingView,
- eksport, import i kopie zapasowe.
