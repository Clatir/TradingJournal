# Historia zmian

Każda sekcja `## X.Y.Z` jest opisem wydania na GitHubie (CI publikuje je samo po podbiciu wersji w `package.json`),
a aplikacja pokazuje go w „Ustawienia → Aktualizacje” i po aktualizacji.

## 1.3.0

### Nowe
- **Prognoza wypłat** (`Ctrl+7`, przycisk „Prognoza”): ile zarobisz i wypłacisz miesiąc po miesiącu, kiedy kupisz cele
  zakupowe i jak działa fundusz celowy (odkładana wypłata pracuje razem z kapitałem).
  - Zysk procentowy (stały albo losowy z zakresu) albo z pipsów (instrument, pipsy stałe lub losowe, lot stały, na kwotę
    kapitału albo z ryzyka), miesiące stratne, podatek roczny, wpłaty i wypłaty z kapitału w wybranych miesiącach.
  - Do 10 celów zakupowych z kwotą albo „cała pula”, „może poczekać”, statusy i opóźnienia.
  - Podsumowanie, tabela miesięcy z podsumowaniami lat, wykres, rozrzut wyników (wiele przebiegów z percentylami).
  - Scenariusze zapisane w folderze danych (`forecasts/`), porównanie dwóch scenariuszy, duplikowanie.
  - Eksport tabeli: schowek (Excel), CSV i XLSX (arkusze: Prognoza, Lata, Cele, Ustawienia).
  - „Weź z moich wyników”: zwrot losowy i miesiące stratne ustawione z miesięcznych wyników dziennika (R × ryzyko %),
    z podglądem przed zmianą scenariusza.
- **Kursy walut z NBP**: tabela A pobierana automatycznie (20 s po starcie, gdy ostatnia ma ponad 12 h) albo przyciskiem.
  Bez internetu zostaje ostatnia pobrana tabela. Kursy wpisane ręcznie mają pierwszeństwo i można wrócić do kursu NBP.
- **Instrumenty**: lista w ustawieniach (dodawanie, archiwizacja, „Przywróć domyślne”), wspólna dla kalkulatora zysku /
  straty i prognozy. Dotychczasowe instrumenty i ręczne wartości pipsa przechodzą bez zmian.
- **Kalkulator pozycji**: pole „TP (pips)”, zysk przy TP i zysk do ryzyka.
- **Kalkulatory w PLN**: kalkulator pozycji, zysku / straty i partiali liczą i pokazują kwoty w walucie kalkulatora
  (domyślnie PLN, pole obok „Kapitał”), także gdy konto jest w USD – po kursie NBP; wartość pipsa z kursu NBP (widać
  tabelę, z której pochodzi). Liczba lotów się nie zmienia.
- **Partiale w kalkulatorze**: porównanie „zamknij całość teraz” z podziałem na 1–4 części (teraz albo na celu w pipsach,
  opcjonalnie SL reszty na BE). Wynik każdej części, najlepszy i najgorszy przypadek, każdy scenariusz (osiągnięte cele,
  reszta na SL/BE) i różnica względem zamknięcia teraz.
- Kurs wpisany ręcznie, który odbiega od kursu NBP o ponad 3%, jest oznaczony („odbiega od NBP (3.8881) o +8.0%”)
  przy polu kursu i na liście kursów w ustawieniach.
- **Kurs z dnia transakcji**: kwoty transakcji w innej walucie niż konto są przeliczane po kursie NBP z ostatniej
  tabeli przed dniem zamknięcia (jak przy rozliczeniu podatku), np. „+100.00 USD ≈ +385.00 PLN (NBP 2026-10-01)”.
  Archiwum kursów pobiera się samo (tylko brakujące dni) i jest zapisane w folderze danych – działa też offline.
- **Wynik z lotów**: transakcja bez wpisanej kwoty ryzyka ma wynik w pieniądzu z lotów (pipsy × wartość pipsa × loty,
  w walucie kwotowanej, przeliczony po kursie z dnia) – w edytorze, analityce i CSV („· z lotów”).
- **Import historii od brokera** (Ustawienia → Eksport, import, kopie): raport HTML z MetaTrader 4/5, XLSX z XTB
  xStation albo CSV z tych plików. Pozycje są dopasowywane do wpisów (para, kierunek, czas wejścia w tolerancji) i mogą
  uzupełnić puste pola: cenę wejścia, TP, SL, wyjścia z czasem (partiale), loty i wynik netto (zysk + prowizja + swap).
  Pozycje bez wpisu mogą stać się nowymi wpisami. Numer pozycji zostaje we wpisie (widać go w edytorze), więc ponowny
  import nic nie dubluje; lista wpisów bez pozycji u brokera.
- **Raport miesięczny** (Analityka, pasek pod wskaźnikami, albo paleta `Ctrl+K`): wynik w R i w PLN (kwoty po kursie
  NBP z dnia przed zamknięciem), tygodnie, pary, najczęstsze błędy z kosztem, zgodność z zasadami, plan dnia, najlepsza
  i najgorsza transakcja. Do schowka jako markdown, do pliku `.md` albo PDF (A4).
- Kursy NBP sprawdzane także co godzinę, gdy aplikacja jest otwarta (nowa tabela pojawia się w dni robocze około 12:15).
  Bez internetu kalkulatory liczą z ostatniej pobranej tabeli.

### Poprawki
- Adnotacje: bardzo szybko narysowany kształt (krótkie przeciągnięcie) nie znika.
- Strzałki ↑/↓ w polach liczb nie zaokrąglają poniżej kroku (np. lot 0.1 → 0.11).
- Kalkulator zysku / straty nie proponuje zarchiwizowanych instrumentów.
- Sprawdzanie aktualizacji i pobieranie kursów nie zawiesza się, gdy serwer przestaje odpowiadać w trakcie odpowiedzi.
- Aktualizacja wersji przenośnej: wpisy dziennika `update.log` nie giną przy chwilowej blokadzie pliku.
- Kwoty transakcji pamiętają swoją walutę: po zmianie waluty konta (np. USD → PLN) dawne kwoty są pokazywane w swojej
  walucie i przeliczone na nową („+100.00 USD ≈ +388.81 PLN”), zamiast udawać kwoty w PLN. CSV ma kolumnę „Waluta kwot”.
  W edytorze transakcji pole „Waluta kwot” pozwala poprawić walutę, gdy kwoty wpisano w innej.
- `Ctrl+Shift+4` (`Ctrl+$`) zawsze przełącza kwoty – nie otwiera Biblioteki, gdy system podaje cyfrę zamiast „$”.

### Ważne przy pracy na kilku komputerach
- Format danych się nie zmienia (wersja 1.2.x otwiera folder normalnie), ale **kopia dzienna zrobiona wersją 1.2.x nie
  zawiera scenariuszy prognozy, a import w wersji 1.2.x je pomija**. Zaktualizuj aplikację na wszystkich komputerach.

## 1.2.1

### Poprawki
- **Kalkulator zysku / straty**
  - Ręcznie wpisana wartość pipsa zachowuje znaczenie po zmianie kroku lota (albo najmniejszego lota instrumentu własnego). Wcześniej wynik mógł się po cichu zmienić 10×.
  - Pola lotów i pipsów pokazują dokładnie to, co jest liczone (np. 0.015 lota, 12.25 pipsa), zamiast zaokrąglać wyświetlanie.
  - Wynik 0 opisany jako „bez zmian”, czytelny komunikat przy ujemnej wielkości pozycji, duże kwoty z odstępami co 3 cyfry.
- **Zmiana waluty konta**: kursy przeliczeniowe i ręczne wartości pipsa są pamiętane osobno dla każdej waluty, zamiast błędnie przechodzić na nową walutę.
- **Krok lota 0.001**: kalkulator pozycji, edytor transakcji i eksport CSV nie obcinają lotów do 2 miejsc po przecinku.
- **Słowniki**: zmiana nazwy na już istniejącą jest odrzucana z komunikatem. Nazwę (także killzone) można wyczyścić i wpisać od nowa; zmiana zapisuje się po wyjściu z pola.
- **Killzone'y**: ostrzeżenie, gdy początek = koniec (taka killzone nigdy nie obejmie transakcji).

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
