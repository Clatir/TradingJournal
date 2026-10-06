# Historia zmian

Każda sekcja `## X.Y.Z` jest opisem wydania na GitHubie (CI publikuje je samo po podbiciu wersji w `package.json`),
a aplikacja pokazuje go w „Ustawienia → Aktualizacje” i po aktualizacji.

## 1.4.9

### Nowe
- **Krzywa zarobków w PLN** (Analityka, pod krzywą equity w R): skumulowany wynik zamkniętych transakcji w złotych,
  w kolejności zamknięć, z drawdownem w PLN pod wykresem. Działa z filtrami dat i par jak cała strona.
  - Obok podsumowanie: wynik, max drawdown, najlepsza i najgorsza transakcja, średnia wygrana i strata oraz liczba
    transakcji w krzywej („3 z 4”).
  - Kwoty w innej walucie są przeliczane jak w raporcie miesięcznym: kursem NBP z dnia przed zamknięciem, a gdy
    archiwum go nie ma – dzisiejszym. Podsumowanie mówi, ile przeliczono którym kursem.
  - Transakcje bez kwoty i lotów można szacować (R × ryzyko % × saldo konta, oznaczone „≈”). Szacowanie wyłącza
    pole wyboru w panelu. Pominięte transakcje (bez danych albo bez kursu) są policzone i opisane.
  - Gdy kwoty są ukryte (Ctrl+$), panel ma przycisk „Pokaż kwoty”.

## 1.4.8

### Poprawki
- **Kwota zysku / straty w dzienniku** (kolumna „Kwota”):
  - **Dodanie kolumny** („Kolumny” → „Kwota”) włącza pokazywanie kwot. Wcześniej kwoty były ukryte i kolumna
    pokazywała tylko „•••”. Gdy kwoty są ukryte (Ctrl+$), nagłówek „Kwota •••” odkrywa je jednym kliknięciem.
  - **Nowa kolumna „Kwota” trafia obok „R”**, a tabela przewija się w bok, gdy kolumny nie mieszczą się obok
    podglądu (wcześniej końcowe kolumny chowały się pod nim).
  - **Szacunek z ryzyka %** dla transakcji bez kwot i lotów: R × ryzyko % × saldo konta z kalkulatora pozycji,
    oznaczony „≈”. Dokładna kwota zostaje taka jak dotąd: wpisany wynik, R × kwota ryzyka albo wynik z lotów.
  - **„—” ma podpowiedź**, czego brakuje: lotów, kwoty, salda konta albo kursu walut.
  - **„Σ kwota” na pasku podsumowania** dziennika (z liczbą transakcji z kwotą) i linia „Kwota” w podglądzie
    transakcji.

## 1.4.7

### Poprawki
- **Dokładniejszy odczyt screenu z XTB** („Ze screenu XTB” w edytorze transakcji).
  - **Nazwy instrumentów** są dopasowywane do Twoich par mimo typowych pomyłek OCR. Przykłady: „USS00” → US500,
    „DEA40” → DE40, „OIL WTI” → OIL.WTI, „G0LD” → GOLD. Para walut jest rozpoznawana także z opisu XTB („Euro to
    American Dollar currency pair” → EURUSD). Przy dopasowaniu przybliżonym okno pokazuje, co odczytano.
  - **Instrument spoza listy par** można dodać od razu z okna („Dodaj do par”, z poprawką symbolu).
  - **Każda wartość jest czytana kilka razy**: cały panel w czerni i bieli, cały panel w skali szarości oraz każda
    liczba i symbol osobno, tylko z dozwolonymi znakami. Wygrywa wartość, na którą wskazuje większość odczytów.
    Gdy odczyty się różnią, przy polu pojawia się „sprawdź – inny odczyt: …”.
  - **Kontrola wyniku z cenami i wolumenem** (forex i pary z ustawionym „1 lot”): błędnie odczytana cyfra w cenie albo
    inna waluta konta niż w XTB daje ostrzeżenie z wynikiem wyliczonym z cen.
  - Lepiej rozpoznawane etykiety z szumem OCR („2Zysk brutto”, obcięte „Depozyt zabezpiec…” sklejone z „Swap”) i
    symbol poprzedzony ikoną instrumentu.

## 1.4.6

### Nowe
- **Uzupełnianie transakcji ze screenu z XTB** (edytor transakcji → „Ze screenu XTB”): wklej (`Ctrl+V`), przeciągnij
  albo wybierz screen okna „Szczegóły pozycji” z XTB.
  - Aplikacja odczytuje go sama (OCR na tym komputerze, bez internetu): instrument, typ (Buy / Sell), wolumen,
    ceny i czasy otwarcia i zamknięcia, Stop Loss, Take Profit, zysk/strata, prowizję, swap i rolowanie.
  - Przed uzupełnieniem widać tabelę: wartość ze screenu (do poprawienia), wartość w transakcji i pole wyboru.
    Zaznaczone są tylko pola, które coś zmienią.
  - Czasy XTB są czasem warszawskim i tak są przeliczane. Wynik netto trafia do kwoty wyniku w walucie konta z
    ustawień; prowizja i swap – do informacji od brokera („Broker: ze screenu”).
  - Kontrola spójności: kierunek a wynik i ceny, netto a brutto z kosztami, SL po stronie zysku, cena odczytana bez
    kropki dziesiętnej.
  - **Screen nie jest zapisywany** – jest tylko odczytywany w pamięci.
- **Czas wyjścia także w czasie warszawskim**: w „Wyjście i partiale” obok „Czas NY” jest „Czas WAW”. Oba pola można
  edytować, drugie przelicza się samo, a wyjście następnego dnia ma znacznik „+1”.

## 1.4.5

### Poprawki
- **Ropa i inne instrumenty spoza forex** (Ustawienia → Pary): pipsy, limit SL i loty liczone w skali instrumentu.
  - Nowa para ropy (WTI, OIL, OILWTI, USOIL, XTI, BRENT, UKOIL) dostaje od razu: 1 pips = 0.01 USD, 2 miejsca po
    przecinku, 1 lot = 1000 baryłek, symbol TradingView TVC:USOIL / TVC:UKOIL. Ruch 90.37 → 86.83 to 354 pipsy.
  - Para ropy z inną skalą (np. pips jak na forex) jest oznaczona – przycisk „Ustaw jak ropa” poprawia ją jednym
    kliknięciem, a pipsy wszystkich jej transakcji przeliczają się same (wynik w R się nie zmienia).
  - Kolumna **„Maks. SL (p)”**: własny limit zasady „SL nie większy niż próg” dla pary (puste = ogólny z zakładki
    Zasady). Walidator pokazuje, który limit zastosował („SL 47.0 p ≤ 60 p (limit OILWTI)”).
  - Kolumna **„1 lot (jedn.)”**: liczba jednostek w locie dla pary (puste = wartość ogólna, 100 000). Używają jej
    kalkulator pozycji i wynik transakcji z lotów – dla ropy loty nie są już 100× za małe.

## 1.4.4

### Nowe
- **Optymalny podział – koszt względem całości na ostatnim celu**: wynik „Optymalnego podziału” pokazuje też, ile ten
  podział traci względem zamknięcia całej pozycji na ostatnim (najdalszym) celu, gdy cena tam dojdzie – kwota, R i wynik
  całej pozycji na tym celu (np. 40% teraz / 60% na +60: koszt 120.00 USD, 0.60R). Bez klikania „Zastosuj”.

## 1.4.3

### Nowe
- **Partiale – optymalny podział** (`Ctrl+6`, panel „Partiale”, sekcja „Optymalny podział”): ile pozycji zamknąć teraz,
  a ile na każdym celu (w procentach i lotach, w krokach lota), przy szansach dojścia do celów wpisanych wyżej.
  Kryteria:
  - **Najwyższy oczekiwany wynik** – bez SL na BE to zawsze jedno wyjście (całość na celu o największym
    szansa × (cel + SL) albo zamknięcie teraz); partiale nie podnoszą oczekiwanego wyniku, tylko zmniejszają ryzyko.
  - **Bez straty** – najwyższy oczekiwany wynik, przy którym najgorszy możliwy przypadek nie jest stratą
    (np. SL 20, teraz +30: 40% teraz, reszta na najlepszym celu).
  - **Strata najwyżej X R** – to samo z dopuszczalną stratą.
  Tabela celów: oczekiwany wynik 1 lota trzymanego do celu i próg szansy, od którego cel daje więcej niż zamknięcie
  teraz ((teraz + SL) / (cel + SL)). Porównanie z zamknięciem teraz i z Twoim podziałem, przycisk „Zastosuj ten podział”.

## 1.4.2

### Nowe
- **Partiale – ile tracisz względem zamknięcia całości na ostatnim celu** (`Ctrl+6`, panel „Partiale”): ramka
  „Całość na ostatnim celu” pokazuje wynik całej pozycji zamkniętej na najdalszym celu, ile kosztują partiale, gdy
  cena tam dojdzie (kwota i R), oraz oczekiwany wynik trzymania całości przy szansie ostatniego celu (bez celu cała
  pozycja na SL) w porównaniu z oczekiwanym wynikiem podziału. W tabeli części kolumna „vs TP” – strata każdej części
  zamkniętej wcześniej.

## 1.4.1

### Nowe
- **Partiale – sugestia bardziej opłacalnego wariantu** (`Ctrl+6`, panel „Partiale”): przy każdym celu pole „szansa”
  (prawdopodobieństwo, że cena do niego dojdzie, domyślnie 100%). Kalkulator liczy szansę każdego scenariusza i
  oczekiwany wynik podziału (średnia wyników ważona szansą) i wskazuje, co jest bardziej opłacalne: podział na podane
  partiale czy zamknięcie całości teraz – z różnicą w kwocie. Dalszy cel nie może mieć większej szansy niż bliższy
  (cena musi przez niego przejść) – taka szansa jest obniżana i oznaczona `*`.

## 1.4.0

### Nowe
- **Sesje analizy portfolio** (stoper „Analiza” w górnym pasku, `Ctrl+Shift+A`): mierzysz czas przeglądu wszystkich par,
  możesz zaznaczać parę, którą właśnie analizujesz, a na koniec dla każdej pary wybierasz: handluję / obserwuję /
  odrzucam (z powodami ze słownika „Powody odrzucenia pary”). Kilka godzin później (albo następnego dnia) aplikacja
  krótko pyta, czy odrzucona para dała jednak dobry setup.
  - Analityka i raport miesięczny: lejek (pary → wybrane → wejścia → wygrane), czas analizy na transakcję i na 1R,
    trafność odrzuceń wg powodów, pary, czas analizy a wynik dnia.
  - Transakcja z pary wybranej w sesji ma oznaczenie „z analizy”. Sesję można też wpisać ręcznie i poprawić czas.
- **Dwa komputery naraz**: gdy dziennik jest otwarty na dwóch komputerach i na jednym coś zmienisz, drugi przyjmuje
  zmianę. Jeśli ten sam wpis był właśnie edytowany, zmiany są scalane pole po polu, a o pola zmienione po obu stronach
  aplikacja pyta (moja / z drugiego komputera). W Ustawienia → Folder danych można wybrać „Zawsze pytaj przed
  przyjęciem zmian”. Nic nie ginie – odrzucona
  wersja zostaje w historii zmian.
- **Historia zmian wpisu** (przycisk „Historia” w transakcji, planie dnia, tygodniu, bibliotece i ustawieniach): poprzednie
  wersje z różnicami pole po polu i przywracanie. Usunięte wpisy można przywrócić (Synchronizacja). Historia leży w
  folderze danych (`.history/`), widać, który komputer zapisał wersję.
- **Szablony planu dnia** (przycisk „Szablon” w planie dnia): zapisz plan jako szablon (pary, DOL, poziomy, scenariusze,
  instrumenty), wstaw go do innego dnia (uzupełnia tylko puste pola) albo ustaw ★ szablon domyślny dla nowych planów.
- **Samopoczucie**: sen (h), energia i stres 1–5 w planie dnia; rano w dni handlowe krótkie pytanie (można wyłączyć).
  Analityka pokazuje wynik, win rate i błędy wg snu, energii i stresu.
- **Mapa godzin** (Analityka): dzień tygodnia × godzina wejścia NY – Σ R, średnie R, win rate, liczba transakcji i błędy.
- **Trening** (`Ctrl+8`): karty z dawnych transakcji – widzisz screen „przed” bez wyniku, decydujesz long / short / nie
  wchodzę (klawisze L / S / N), opcjonalnie wpisujesz SL, potem odkrywasz wynik i screeny „po”. Najpierw karty nigdy
  nie ćwiczone, potem te z błędną odpowiedzią. Trafność decyzji, kierunku i SL w czasie i wg pary.
- **Własne pola transakcji** (Ustawienia → Słowniki): lista opcji (np. ocena setupu A+/A/B), liczba, tak/nie, tekst –
  w edytorze, jako kolumny listy, w filtrach, w analityce (wynik wg pola), w CSV i w markdownie.
- **Lista transakcji**: wybór i kolejność kolumn (także nowe: PD array, płynność, godzina wyjścia, czas trwania, loty,
  ryzyko %, kwota, notatki), filtry (daty, wynik, zasady, błędy, model, własne pola) i **zapisane filtry** pod nazwą –
  także w palecie `Ctrl+K`.

### Poprawki
- Import (scal) dołącza powody odrzucenia par i własne pola z importowanego dziennika.
- Edycja wpisu, który w tym samym czasie zmienił się na drugim komputerze, nie nadpisuje już po cichu tamtej zmiany.

### Ważne przy pracy na kilku komputerach
- Format danych się nie zmienia (wersja 1.3.x otwiera folder), ale **1.3.x nie zna treningów (`drills/`), historii
  zmian, własnych pól i sesji analizy** – zachowuje je w plikach, ale ich nie pokazuje, a kopia dzienna i import w 1.3.x
  pomijają `drills/`. Zaktualizuj aplikację na wszystkich komputerach.

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
