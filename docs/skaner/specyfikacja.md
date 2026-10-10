# Skaner ICT — prompt dla Claude Code

Oct 10, 2026 · @Szymon Malitka

## 1. Rola i cel

Budujesz moduł „Skaner ICT” w istniejącej aplikacji Windows „ICT Trade Journal”. Działasz jak doświadczony inżynier aplikacji desktopowych, który zna metodologię ICT (Inner Circle Trader) na tyle, by zamienić jej pojęcia na deterministyczne, testowalne reguły.

Moduł na żywo obserwuje edytowalną listę instrumentów (pary FX, XAUUSD, WTI) na danych EODHD. Wykrywa setupy zgodne z zasadami użytkownika, ocenia je w skali A/B/C i pokazuje na pulpicie wielu wykresów z gotowymi poziomami wejścia, SL i TP.

Czym moduł nie jest:

- Nie składa zleceń i nie łączy się z brokerem. Wspiera decyzję, którą podejmuje użytkownik.
- Nie używa klasycznych wskaźników (RSI, MACD, średnie kroczące) jako sygnałów. Logika opiera się wyłącznie na pojęciach ICT.
- Nie prognozuje. Każdy sygnał pokazuje, z czego wynika, i ma jawny poziom unieważnienia.

Dwie zasady nadrzędne dla całego kodu:

1. Detektory działają tylko na zamkniętych świecach i nigdy nie zaglądają w przyszłość.
2. Tryb live i tryb replay używają tego samego potoku przetwarzania. Różni je wyłącznie źródło świec.

## 2. Kontekst

**Użytkownik.** Day trader ICT pracujący na Windows. Analizuje top-down W → D → H4 → H1, wejścia doprecyzowuje na M15/M5. Wykresy ogląda w TradingView na feedzie OANDA, godziny liczy w czasie nowojorskim. Nie zna stosu technologicznego dziennika, więc rozmawiaj z nim po polsku, prostym językiem, bez żargonu programistycznego. Terminy ICT zostają po angielsku.

**Istniejąca aplikacja.** ICT Trade Journal to aplikacja desktopowa na Windows uruchamiana jako .exe, używana na kilku komputerach. Dane trzyma w czytelnej, łatwej do przeniesienia formie i kompresuje zrzuty ekranu. Skaner jest nową zakładką tej aplikacji: ten sam kod, ten sam styl wizualny, ten sam proces budowania.

**Zasady tradingowe użytkownika.** Są nadrzędne wobec ogólnych reguł ICT. Tam, gdzie milczą, stosuj standardowe ICT.

| Obszar | Zasada |
| --- | --- |
| Instrumenty startowe | AUDUSD, EURAUD, EURGBP, EURUSD, USDCHF, XAUUSD, WTI. Lista edytowalna w aplikacji. |
| Sesje | London i New York |
| Modele wejścia | Sweep płynności sesyjnej w killzone → MSS z displacementem → wejście na FVG lub OB. OTE 62–79% po MSS na OB lub FVG. Silver Bullet. Turtle soup. Breaker. Wszystkie elementy PD array. |
| Stop loss | Za swingiem tworzącym setup albo za FVG/OB wejścia. Nigdy w oczywistej płynności ani tuż przed niezbalansowanym PD array. Maksymalnie 20 pipsów. |
| Take profit | Pierwsza pula płynności, kilka pipsów przed poziomem. Minimalny R:R 2:1. |
| Newsy | W dniu danych high-impact (HIN) dla USD i EUR bez pozycji, chyba że jest oczywisty element PDA do zebrania płynności podczas publikacji. |
| Oznaczenia | „D FVG” / „240 FVG” / „60 FVG” = FVG z D / H4 / H1. Strefy zielone = spadkowe, burgundowe = wzrostowe. |
| Intermarket | DXY, EURX oraz futures na obligacje FGBL1! (Bund) i ZB1! (T-Bond) jako potwierdzenie kierunku. |

**Decyzje z wywiadu.** Skaner jako moduł dziennika. Bias HTF w trybie hybrydowym (propozycja skanera plus ręczne nadpisanie). Cztery modele wejścia od pierwszej wersji. Indeksy syntetyczne i SMT. Wszystkie sygnały z oceną A/B/C. Pulpit wielu wykresów. Alerty dźwiękowe i powiadomienia Windows z osobnymi przełącznikami. Kalkulator wielkości pozycji z ustawień konta. Automatyczny kalendarz makro. Okna czasowe użytkownika, edytowalne. Replay ze statystykami.

**Doprecyzowania z drugiego wywiadu.** Swing to klasyczne 3 świece. MSS wymaga zamknięcia i displacementu. Karta pokazuje dwa poziomy wejścia: krawędź i CE. Największą wagę mają EQH/EQL z H1 i poziomy zbieżne na kilku interwałach; high i low sesji oraz PDH/PDL też tworzą setup. Przy sprzeczności bias wyznacza struktura. Spójność waluty, indeksu i obligacji jest warunkiem ważności setupu. Margines TP to 3–5 pipsów. Cel to 4–8 alertów dziennie. Komputer bywa wyłączony w nocy. Plik .exe pochodzi z automatycznego buildu na GitHubie.

**Doprecyzowania z trzeciego wywiadu.** Strefą order blocka jest sam korpus. Displacement to korpusy około 2 razy większe od średniej plus FVG. FVG jest ważny do pełnego zamknięcia po drugiej stronie. Setup wygasa z końcem okna. Okna użytkownika to 02:00–04:40 i 07:00–10:00 NY, a klasyczne okna Silver Bullet są dodatkowe. Setupy kontra bias są widoczne z flagą, bez alertu. Maksymalny SL dla złota i ropy jest skalowany do zmienności. Sygnały na skorelowanych parach dostają tylko ostrzeżenie. Briefing dnia ma eksport tekstu. Skaner działa na osobnym monitorze. Konto jest w PLN. Nie ma filtra dni tygodnia. W dzienniku nie ma jeszcze transakcji wzorcowych, więc wzorzec powstanie z ocen użytkownika w replay.

## 3. Tryb pracy

Pracujesz w trzech krokach. Zatrzymujesz się po kroku 1, po kroku 2 i po każdej fazie kroku 3. Za każdym razem czekasz na słowo użytkownika.

**Środowisko pracy.** Sesja działa w chmurze (Claude Code w przeglądarce) na maszynie z Linuksem, nie na komputerze użytkownika. Wynikają z tego cztery zasady:

- Dostęp do EODHD wymaga dodania domen `eodhd.com` i `ws.eodhistoricaldata.com` do dozwolonych w ustawieniach środowiska chmurowego. Jeśli zapytania są blokowane, podaj użytkownikowi te domeny i poczekaj.
- Klucz API jest w zmiennej środowiskowej środowiska chmurowego. Nie wypisuj go w rozmowie, w logach ani w commitach.
- Jeśli WebSocket nie działa przez sieć środowiska, przygotuj mały skrypt testowy, który użytkownik uruchomi na swoim komputerze, i oprzyj wynik testu na jego odczycie.
- Aplikacji Windows tutaj nie uruchomisz. Logikę weryfikuj testami. Wygląd interfejsu oraz funkcje zależne od Windows (powiadomienia, magazyn poświadczeń, build .exe) sprawdza użytkownik u siebie: przy każdym przystanku podaj mu dokładne kroki uruchomienia i listę rzeczy do sprawdzenia.

**Krok 1: rozpoznanie (bez zmian w kodzie aplikacji)**

1. Przeczytaj repozytorium dziennika. Ustal stos technologiczny, strukturę kodu, sposób przechowywania danych, proces budowania .exe, styl interfejsu i mechanizm pracy na kilku komputerach.
2. Zainstaluj oficjalne materiały EODHD dla Claude: plugin `eodhd-api` z repozytorium `EodHistoricalData/eodhd-claude-skills` (dokumentacja endpointów i zakresów planów). Jeśli się nie da, czytaj dokumentację na eodhd.com/financial-apis. Nie polegaj na pamięci co do adresów, pól i limitów.
3. Wykonaj test wykonalności z sekcji 4.1. Klucz API czytaj ze zmiennej środowiskowej EODHD\_API\_TOKEN. Jeśli jej nie ma, poproś użytkownika, żeby dodał ją w ustawieniach środowiska chmurowego. Nie proś o wklejenie klucza do rozmowy i nie zapisuj go w żadnym pliku.
4. Zapisz wyniki w `docs/skaner/rozpoznanie.md`.

**Krok 2: plan do akceptacji**

Napisz `docs/skaner/plan.md`: architektura, wybór technologii z uzasadnieniem względem istniejącego kodu, schemat danych, lista faz, wynik testu wykonalności, ryzyka oraz pytania z sekcji 15. Przedstaw użytkownikowi streszczenie prostym językiem i czekaj na słowo „akceptuję”.

**Krok 3: budowa fazami z odbiorem**

1. Warstwa danych i magazyn świec.
2. Silnik ICT z testami.
3. Modele wejścia, ocena, cykl życia sygnału.
4. Interfejs.
5. Alerty, kalkulator pozycji, newsy.
6. Replay i statystyki.
7. Build .exe, test całości, raport końcowy.

Pracuj na gałęzi `feature/skaner-ict` i rób commit po każdej fazie. Jeśli repozytorium nie jest pod kontrolą git, załóż ją przed pierwszą zmianą. Drobnych wątpliwości nie zgłaszaj: przyjmij rozsądne założenie, zapisz je w `docs/skaner/decyzje.md` i idź dalej.

**Przystanek po każdym kroku i każdej fazie.** Po zakończeniu kroku lub fazy zrób commit, a potem:

1. Podsumuj prostym językiem, co działa, jak użytkownik może to sprawdzić i co odbiega od specyfikacji.
2. Podaj sugerowany model i effort na następny etap z tabeli poniżej, razem z poleceniami do wpisania, np. `/model fable` i `/effort high`.
3. Czekaj na słowo „dalej” (po kroku 2 na słowo „akceptuję”). Nie zaczynaj następnego etapu wcześniej.

| Etap | Do resetu limitu tygodniowego | Po resecie |
| --- | --- | --- |
| Krok 1: rozpoznanie i test EODHD | Opus 5.5, high | Opus 5.5, high |
| Krok 2: plan | Fable 5.1, xhigh | Fable 5.1, high |
| Faza 1: dane i magazyn świec | Opus 5.5, xhigh | Opus 5.5, high |
| Faza 2: silnik ICT | Fable 5.1, xhigh | Fable 5.1, high |
| Faza 3: modele, ocena, cykl życia | Fable 5.1, xhigh | Fable 5.1, high |
| Faza 4: interfejs, briefing, oceny | Opus 5.5, medium | Opus 5.5, medium |
| Faza 5: alerty, kalkulator, newsy | Opus 5.5, medium | Opus 5.5, medium |
| Faza 6: replay, statystyki, kalibracja | Opus 5.5, high | Opus 5.5, high |
| Faza 7: build, test całości, raport | Opus 5.5, high | Opus 5.5, high |
| Poprawki po sprawdzeniach użytkownika | Opus 5.5, high dla logiki, medium dla interfejsu | Opus 5.5, high dla logiki, medium dla interfejsu |

Limit tygodniowy użytkownika odnawia się w niedzielę 11.10.2026 o 18:00 czasu polskiego, a potem co tydzień. Niewykorzystana pula przepada, dlatego przed resetem effort jest wyższy. Przy każdym przystanku sprawdź datę i godzinę i podaj wartości z właściwej kolumny. Etap przerwany resetem dokończ na ustawieniu, na którym się zaczął. Po resecie zaproponuj xhigh dla fazy 3 tylko wtedy, gdy użytkownik potwierdzi, że ma zapas limitu.

Użytkownik ma plan Max 5x, w którym pula Fable jest ograniczona. Jeśli Fable jest niedostępny albo wymaga dopłat, zaproponuj Opus 5.5 na high. W fazie 7 przegląd końcowy wykonaj jako workflow: niezależni agenci sprawdzają brak zaglądania w przyszłość i zgodność kodu ze specyfikacją.

**Specyfikacja i plik postępu.** Na początku kroku 1 upewnij się, że ta specyfikacja leży w repozytorium jako `docs/skaner/specyfikacja.md`. Prowadź też `docs/skaner/postep.md`: bieżący etap, co jest ukończone, co w toku, następny krok, otwarte pytania. Aktualizuj go po każdym znaczącym kroku i commituj razem z kodem. Po każdym wznowieniu pracy (limit użycia, nowa sesja, streszczenie rozmowy) najpierw przeczytaj oba pliki, a potem kontynuuj od zapisanego miejsca. Nie zaczynaj etapu od nowa. Dodaj do pliku CLAUDE.md w repozytorium krótką sekcję, która wskazuje oba pliki, żeby każda sesja czytała je na starcie.

W trakcie fazy zatrzymaj się tylko w trzech sytuacjach:

- zmiana grozi utratą lub uszkodzeniem danych dziennika,
- test wykonalności wyklucza funkcję kluczową dla tej specyfikacji,
- potrzebna jest płatna usługa albo zmiana planu EODHD.

Istniejące funkcje dziennika mają działać jak przed zmianą. Przed każdą migracją danych zrób kopię zapasową.

## 4. Dane: EODHD

Użytkownik ma plan „EOD + Intraday — All World Extended”. Potwierdź uprawnienia przez User API i dostosuj zachowanie do faktycznego stanu. Fakty poniżej pochodzą z dokumentacji EODHD ([WebSocket](https://eodhd.com/financial-apis/new-real-time-data-api-websockets), [Intraday](https://eodhd.com/financial-apis/intraday-historical-data-api)) w stanie na dzień tego dokumentu. Przed implementacją sprawdź je ponownie.

### 4.1 Test wykonalności (krok 1)

Sprawdź kluczem użytkownika i zapisz wynik każdego punktu:

1. **Strumień FX.** Czy każdy instrument z listy startowej faktycznie streamuje. Uwaga: na płatnym kluczu nieznany lub źle zapisany symbol jest przyjmowany bez błędu i po prostu milczy. Test musi wykrywać ciszę, nie tylko brak błędu.
2. **Złoto.** Czy XAUUSD jest na liście giełdy FOREX, czy streamuje i czy ma historię intraday.
3. **WTI.** Strumień real-time EODHD obejmuje akcje USA i Europy, FX oraz krypto, a Commodities API podaje ceny historyczne. WTI na żywo jest więc prawdopodobnie niedostępne. Sprawdź listę FOREX pod kątem symbolu ropy. Jeśli go nie ma, przedstaw w planie warianty: drugi dostawca tylko dla WTI, WTI z opóźnieniem i wyraźnym oznaczeniem albo rezygnacja z WTI.
4. **Indeksy i obligacje.** Czy są dane intraday dla DXY, EURX oraz kontraktów Bund (FGBL) i T-Bond (ZB).
5. **Świeżość REST intraday.** Dokumentacja podaje, że dane intraday są finalizowane ok. 2–3 godziny po zamknięciu rynku. Zmierz w trakcie sesji, ile minut wstecz od „teraz” sięga ostatnia świeca 1m dla EURUSD. To największe ryzyko projektu (patrz 4.5).
6. **Kalendarz makro.** Czy endpoint `/economic-events` zwraca dane, czy odmowę dla tego planu.
7. **Zgodność cen.** Porównaj high i low kilku świec H1 oraz dziennych EURUSD z wartościami, które użytkownik odczyta z TradingView (OANDA). Podaj typową różnicę w pipsach.

**Test przy zamkniętym rynku.** Rynek FX jest zamknięty od piątku 17:00 NY do niedzieli 17:00 NY. Cisza na strumieniu FX w tym czasie nie oznacza braku symbolu. Jeśli test wypada w weekend, sprawdź mechanikę WebSocket (połączenie, subskrypcja, wznawianie) na strumieniu krypto, o ile plan na to pozwala. Punkty 1, 5 i 7 oznacz jako odroczone i wykonaj po otwarciu rynku. Fazy 1–3 i 6 mogą powstawać na danych historycznych bez czekania na otwarcie. Część live fazy 1 zamknij dopiero po odroczonych punktach.

### 4.2 Strumień live (WebSocket)

- Adres: `wss://ws.eodhistoricaldata.com/ws/forex?api_token=…`. Tylko `wss://`.
- Subskrypcja: `{"action":"subscribe","symbols":"EURUSD,GBPUSD"}`. Lista symboli to jeden napis rozdzielony przecinkami, bez separatora w symbolu, wielkimi literami. Tablica JSON kończy się błędem 422.
- Tick FX: `s` symbol, `a` ask, `b` bid, `t` czas w milisekundach epoch. Stan kluczuj po polu `s` z odpowiedzi.
- Limit: 50 symboli na klucz API, liczony łącznie dla wszystkich otwartych połączeń. Jedno połączenie, jedna wiadomość subscribe z całą listą. Limit połączeń: 64 na klucz.
- Budżet symboli: instrumenty użytkownika + składniki indeksów syntetycznych (sekcja 7) + pary do SMT + para przeliczeniowa dla waluty konta. Pokaż zużycie budżetu w ustawieniach. Dwa komputery pracujące jednocześnie dzielą ten sam limit.
- WebSocket nie zużywa dziennego limitu wywołań API.
- Po każdym wznowieniu połączenia lista subskrypcji jest pusta: wyślij ją ponownie.
- Świece buduj z ceny mid, z przełącznikiem bid/mid w ustawieniach. Domyślną ustaw tę, która w teście zgodności lepiej pasuje do TradingView.
- FX nie ma realnego wolumenu. Nie używaj wolumenu w żadnej regule.
- Odporność: wznawianie z rosnącym odstępem, wykrywanie cichego strumienia w godzinach rynku, uzupełnienie luki po wznowieniu, status połączenia w interfejsie.

### 4.3 Historia (REST intraday)

- Adres: `https://eodhd.com/api/intraday/EURUSD.FOREX?interval=1m&from=…&to=…&fmt=json`. Czas `from`/`to` jako Unix UTC.
- Interwały: tylko 1m, 5m i 1h. Znaczniki czasu w UTC.
- Maksymalny zakres na zapytanie: 1m 120 dni, 5m 600 dni, 1h 7200 dni.
- Koszt: 5 wywołań na zapytanie. Zaimplementuj licznik zużycia, kolejkę z ograniczeniem tempa i cache na dysku, żeby nie pobierać dwa razy tych samych danych.
- Głębokość przy pierwszym uruchomieniu: 1m z 120 dni (replay, M5, M15), 1h z 3 lat (H4, D, W, zakresy IPDA).
- Endpoint minutowych świec `/history` nie obsługuje FX (zwraca pustą listę). Nie nadaje się do łatania luk.

### 4.4 Magazyn i agregacja świec

Bazą jest świeca M1 z ticków live i z REST. Interwały M5, M15, H1, H4, D i W składasz samodzielnie:

- Strefa `America/New_York` z bazy IANA, z poprawną zmianą czasu. Nigdy stałe przesunięcie względem UTC.
- Doba handlowa: od 17:00 NY do 17:00 NY. Świeca D oraz PDH/PDL liczone w tej granicy.
- H4 wyrównane do 17:00 NY (17, 21, 01, 05, 09, 13).
- Tydzień: od niedzieli 17:00 NY do piątku 17:00 NY.
- Poziomy otwarcia: midnight open (00:00 NY), 08:30 NY, otwarcie tygodnia.
- Minuta bez ticków nie tworzy świecy. Luki weekendowe i świąteczne nie są błędem.
- Świeca w budowie jest widoczna na wykresie, ale detektory jej nie dostają.

Magazyn lokalny (np. SQLite, chyba że dziennik ma już coś odpowiedniego). Dane rynkowe trzymaj osobno od danych dziennika i poza folderem synchronizowanym między komputerami: to odtwarzalny cache, który szybko rośnie.

### 4.5 Luka po uruchomieniu w środku sesji

Jeśli REST nie udostępnia świec z bieżących godzin, aplikacja włączona o 08:00 NY nie zna przebiegu sesji Asia i London, a bez nich nie ma sweepów sesyjnych. Komputer użytkownika bywa wyłączony w nocy, więc to codzienny przypadek, nie wyjątek. Rozwiązanie zależy od wyniku testu 4.1.5:

- Jeśli REST jest świeży (opóźnienie rzędu minut): uzupełniaj lukę z REST przy starcie i po każdym wznowieniu.
- Jeśli nie: zbieraj ticki w tle. Aplikacja zminimalizowana do zasobnika systemowego lub osobny lekki proces zbierający dane od otwarcia rynku w niedzielę. Zaproponuj wariant w planie.
- W obu przypadkach: każdą lukę w M1 zapisuj jawnie. Detektor, którego okno danych zawiera lukę, oznacza wynik jako niepewny, a kafelek instrumentu pokazuje ostrzeżenie „niepełne dane”. Nigdy nie udawaj ciągłości.

### 4.6 Klucz API

Nigdy w repozytorium ani jawnym tekstem w folderze synchronizowanym. Przechowuj przez Windows Credential Manager lub DPAPI, wpisywany w ustawieniach, maskowany w logach.

## 5. Silnik ICT: definicje

Każde pojęcie to osobny, czysty detektor. Wejście: zamknięte świece jednego interwału i parametry. Wyjście: lista obiektów z czasem powstania, poziomami i stanem. Wszystkie progi są parametrami w ustawieniach. Jednostką odległości jest pips instrumentu (sekcja 8.5).

ICT jest dyskrecjonalne, więc poniższe definicje to punkt startowy do strojenia. Każdy wykryty obiekt musi dać się zobaczyć na wykresie, żeby użytkownik mógł ocenić, czy detektor widzi to samo co on.

### 5.1 Rdzeń (buduj najpierw)

| Pojęcie | Definicja operacyjna | Wartości domyślne |
| --- | --- | --- |
| Swing high / low | Świeca, której high (low) jest wyższy (niższy) niż N świec po lewej i N po prawej. Istnieje dopiero po zamknięciu N-tej świecy po prawej. | N = 1 na wszystkich interwałach (klasyczny swing z 3 świec). Rangę swingu wyznacza jego klasa, nie N |
| Klasy swingów | Short-term (STH/STL). Intermediate (ITH/ITL): swing wyższy (niższy) od sąsiednich swingów po obu stronach. Long-term: to samo liczone na ITH/ITL. | brak |
| Pule płynności (BSL/SSL) | PDH/PDL, PWH/PWL, PMH/PML, high i low sesji, EQH/EQL, niezebrane swingi H1, H4 i D, ekstrema z 20, 40 i 60 dni (zakresy IPDA). Stan: nietknięta lub zebrana, z czasem zebrania. | Sesje w czasie NY: Asia 20:00–00:00, London 02:00–05:00, NY AM 07:00–10:00 |
| EQH / EQL | Co najmniej dwa swingi tego samego typu w odległości nie większej niż tolerancja, bez przebicia między nimi. | Tolerancja: 2 pipsy na M15, 3 na H1, 5 na H4 i wyżej |
| Sweep | Knot przebija pulę o co najmniej minimum, a ta świeca lub jedna z K kolejnych zamyka się z powrotem po wewnętrznej stronie poziomu. Zamknięcia poza poziomem dłużej niż K świec to wybicie, nie sweep. | Minimum 0.5 pipsa, K = 3 |
| Displacement | Jedna do trzech świec w jednym kierunku, których łączny korpus wynosi co najmniej m × średni korpus z 20 poprzednich świec, i które zostawiają FVG. | m = 2.0 |
| MSS | Zamknięcie świecy poza ostatnim przeciwnym swingiem, wykonane ruchem z displacementem. | Wymagany FVG w nodze wybicia |
| BOS | Zamknięcie poza ostatnim swingiem zgodnie z dotychczasowym kierunkiem struktury. | brak |
| FVG (BISI / SIBI) | Trzy świece: low trzeciej powyżej high pierwszej (byczy) albo high trzeciej poniżej low pierwszej (niedźwiedzi). Poziomy: obie granice i CE (50%). Stany: otwarty, dotknięty, CE osiągnięte, wypełniony, odwrócony (inversion FVG po zamknięciu przez całą lukę). | Min. rozmiar w pipsach: 1 na M5, 2 na M15, 4 na H1, 8 na H4, 15 na D |
| Order block | Ostatnia świeca przeciwna przed displacementem, który wybił strukturę. Strefą jest sam korpus, od open do close, bez knotów. Poziomy: open, close, mean threshold (50% korpusu). Nieważny po zamknięciu świecy poza nim. | brak |
| Breaker block | Order block, przez który cena przeszła z displacementem po wcześniejszym sweepie. Działa w przeciwną stronę. | brak |
| Dealing range | Zakres między ostatnim znaczącym swing high i swing low danego interwału. Equilibrium = 50%. Powyżej premium, poniżej discount. | Liczony dla H1, H4 i D |
| OTE | Zniesienie 62–79% nogi impulsu, od swingu początkowego do ekstremum po MSS. Środek: 70.5%. | 62 / 70.5 / 79 |
| Poziomy otwarcia | Midnight open, 08:30 NY, otwarcie tygodnia. NDOG: luka między zamknięciem 17:00 a otwarciem 18:00 NY. NWOG: luka piątek–niedziela. Dla luk: granice i CE. | brak |
| Okna czasowe | Killzone'y i okna Silver Bullet (sekcja 6). | Edytowalne |

**Zbieżność poziomów między interwałami.** Pula płynności zyskuje rangę, gdy jej poziom pokrywa się w tolerancji EQH/EQL z pulą z innego interwału, np. H1 z H4 albo D z H4 i H1. Każda pula ma rangę równą liczbie interwałów, na których jest widoczna. Ranga wchodzi do oceny setupu i jest pokazana na etykiecie puli. Użytkownik przywiązuje do takich punktów największą wagę. Pozostałą hierarchię płynności ustaw zgodnie z nauczaniem ICT.

### 5.2 Rozszerzenia (ten sam interfejs detektora, po rdzeniu)

- Mitigation block: jak breaker, ale bez wcześniejszego sweepu.
- Rejection block: strefa długiego knota na kluczowym swingu, od korpusu do końca knota.
- Balanced price range (BPR): część wspólna dwóch przeciwnych FVG.
- Volume imbalance i liquidity void: luka między korpusami sąsiednich świec oraz jednostronny ruch bez pokrycia.
- Power of 3 i Judas swing: etykiety dobowe. Akumulacja wokół midnight open, manipulacja jako ruch przeciwny do biasu zbierający płynność w London lub NY, potem dystrybucja.

Rozszerzenia zasilają ocenę setupu i warstwy wykresu. Nie tworzą własnych sygnałów.

## 6. Modele wejścia

Skaner wykrywa cztery modele, każdy niezależnie na M5 i M15. Kierunek zgodny z biasem dnia daje pełną ocenę. Kierunek przeciwny nie jest ukrywany: sygnał dostaje flagę „kontra”, niższą ocenę i nie uruchamia alertu.

**Okna czasowe (czas NY, edytowalne)**

| Okno | Godziny | Dla modeli |
| --- | --- | --- |
| London (okno użytkownika) | 02:00–04:40 | wszystkie |
| NY AM (okno użytkownika) | 07:00–10:00 | wszystkie |
| Silver Bullet (klasyczne, dodatkowe) | 03:00–04:00, 10:00–11:00, 14:00–15:00 | tylko Silver Bullet |

Setup, którego sweep i wejście wypadają poza oknami, nie jest zgłaszany jako sygnał. Jego elementy pozostają widoczne na wykresie.

Setup uzbrojony wygasa z końcem okna, w którym powstał, jeśli cena nie wróciła do strefy wejścia.

### Model 1: Sweep → MSS → FVG/OB

1. W killzone cena robi sweep puli płynności: high lub low sesji Asia albo London, PDH/PDL, EQH/EQL, swing H1.
2. W ciągu maksymalnie 12 świec M5 następuje MSS z displacementem w przeciwną stronę.
3. Strefa wejścia: FVG z nogi displacementu albo OB, z którego ruszył displacement.
4. Unieważnienie: zamknięcie poza ekstremum sweepu, dojście do celu bez cofnięcia do strefy albo koniec okna.

### Model 2: OTE 62–79%

1. Jest MSS z displacementem po sweepie albo BOS zgodny z biasem.
2. Cena cofa się do 62–79% nogi impulsu.
3. W strefie OTE musi leżeć FVG lub OB. Bez tej konfluencji nie ma sygnału.
4. Strefa wejścia: część wspólna OTE i PD array. Unieważnienie: zamknięcie poza początkiem nogi.

### Model 3: Silver Bullet

1. W oknie użytkownika albo w klasycznym oknie Silver Bullet powstaje FVG na M5 (opcjonalnie M1).
2. FVG jest skierowany w stronę najbliższej nietkniętej puli płynności oddalonej o co najmniej 15 pipsów.
3. Wejście na powrocie do FVG w tym samym oknie. Wcześniejszy sweep przeciwnej strony podnosi ocenę.
4. Unieważnienie: zamknięcie przez cały FVG albo koniec okna bez wejścia.

### Model 4: Turtle soup i breaker

- **Turtle soup.** Sweep starego high lub low z wyższego interwału (PDH/PDL, swing H1 lub H4, ekstremum 20-dniowe) w strefie premium dla shorta albo discount dla longa. Wariant domyślny: wejście po potwierdzeniu przez MSS na M5. Wariant agresywny (w ustawieniach): wejście po zamknięciu świecy z powrotem za poziomem. SL za ekstremum sweepu.
- **Breaker.** Po sweepie i MSS cena wraca do breaker blocka. Wejście na breakerze, SL za nim albo za swingiem.

Jeśli ten sam ruch spełnia kilka modeli naraz, powstaje jeden sygnał z listą modeli. Zbieżność modeli podnosi ocenę.

## 7. Bias HTF, indeksy syntetyczne, SMT

### 7.1 Bias w trybie hybrydowym

Dla każdego instrumentu skaner wylicza propozycję biasu dnia i draw on liquidity (DOL). Użytkownik może ją zatwierdzić albo nadpisać: byczy, niedźwiedzi lub neutralny, z własnym DOL. Nadpisanie ma pierwszeństwo, jest wyraźnie oznaczone i obowiązuje do końca doby handlowej albo do odwołania.

Propozycja powstaje osobno dla W, D, H4 i H1 z czterech składników:

- struktura: ostatnie MSS lub BOS z displacementem,
- order flow: czy FVG zgodne z kierunkiem są respektowane, a przeciwne przebijane,
- położenie ceny w dealing range (premium lub discount),
- najbliższy niezebrany cel po obu stronach ceny: pula płynności albo niewypełniony FVG z wyższego interwału.

Wynik: kierunek, pewność (niska, średnia, wysoka) i lista powodów. Gdy interwały są sprzeczne, pokaż to wprost (np. „D byczy, H4 niedźwiedzi: korekta do D FVG”) i ustaw pewność na niską. Dla day tradingu pierwszeństwo mają D i H4. H1 służy do synchronizacji wejścia. Gdy struktura i cel (DOL) wskazują przeciwne kierunki, wygrywa struktura: kierunek wyznacza ostatni MSS lub BOS z displacementem na D i H4.

### 7.2 Indeksy syntetyczne

Jeśli EODHD nie streamuje DXY i EURX, licz je tick po ticku z par FX:

```latex
\mathrm{DXY} = 50.14348112 \times \mathrm{EURUSD}^{-0.576} \times \mathrm{USDJPY}^{0.136} \times \mathrm{GBPUSD}^{-0.119} \times \mathrm{USDCAD}^{0.091} \times \mathrm{USDSEK}^{0.042} \times \mathrm{USDCHF}^{0.036}
```

```latex
\mathrm{EURX} = 34.38805726 \times \mathrm{EURUSD}^{0.3155} \times \mathrm{EURGBP}^{0.3056} \times \mathrm{EURJPY}^{0.1891} \times \mathrm{EURCHF}^{0.1113} \times \mathrm{EURSEK}^{0.0785}
```

Zweryfikuj stałe i wagi w definicjach ICE, a wynik porównaj z wartościami, które użytkownik odczyta z TradingView. Indeks syntetyczny jest przybliżeniem kierunku i struktury, nie dokładnego poziomu. Indeksy mają własne świece i przechodzą przez te same detektory co instrumenty.

### 7.3 SMT divergence

Jeden instrument robi nowe ekstremum i zbiera pulę, a skorelowany tego nie potwierdza, w oknie ±3 świec tego samego interwału (M15 i H1).

| Para porównania | Korelacja |
| --- | --- |
| EURUSD i GBPUSD | dodatnia |
| AUDUSD i NZDUSD | dodatnia |
| EURUSD i USDCHF | ujemna |
| EURUSD, AUDUSD, XAUUSD wobec DXY | ujemna |
| USDCHF wobec DXY | dodatnia |
| EURAUD, EURGBP wobec EURX | dodatnia |

Mapa korelacji jest edytowalna. SMT przy sweepie podnosi ocenę setupu. Sama nie tworzy sygnału.

**Ta sama ekspozycja.** Gdy jednocześnie aktywne są sygnały na skorelowanych instrumentach w kierunkach dających tę samą ekspozycję, np. EURUSD long i USDCHF short, obie karty dostają flagę „ta sama ekspozycja”. Skaner tylko ostrzega i nie podpowiada wyboru.

### 7.4 Obligacje (FGBL, ZB)

Zasada użytkownika: setup jest ważny, gdy bias waluty, jej indeksu i jej obligacji jest spójny. Spójność oznacza, że indeks rośnie, a cena obligacji spada (rentowności rosną). Dla USD: DXY w górę i ZB w dół. Dla EUR: EURX w górę i FGBL w dół. Dla kierunku spadkowego odwrotnie.

- Dla każdej waluty w parze sprawdź spójność trzech elementów na D i H4: kierunek wynikający z setupu, bias indeksu (DXY, EURX) i bias obligacji (ZB, FGBL).
- Jeśli test wykonalności potwierdzi dane intraday obligacji, licz ich bias tymi samymi detektorami co dla instrumentów. Jeśli nie, użytkownik ustawia bias obligacji ręcznie w panelu bias (rośnie, spada, neutralny), z ważnością do odwołania.
- Sygnał bez spójności dostaje flagę „brak spójności intermarket”, nie może mieć oceny A i nie uruchamia alertu. To zachowanie jest przełączalne w ustawieniach.
- Dla walut bez indeksu i obligacji w skanerze (AUD, GBP, CHF) kryterium dotyczy tylko drugiej waluty pary. Dla XAUUSD i WTI liczy się strona USD.

Brak ustawionego biasu obligacji to nie to samo co niespójność. W takim przypadku sygnał dostaje flagę „obligacje nieustawione”, nie może mieć oceny A, ale alert działa normalnie. Panel bias przypomina o ustawieniu obligacji na początku doby handlowej.

## 8. Poziomy setupu, ocena, cykl życia

### 8.1 Wejście

Strefa od–do oraz dwa poziomy wejścia liczone równolegle: krawędź FVG lub OB bliższa cenie oraz CE (dla OB mean threshold). Karta setupu pokazuje dla każdego poziomu osobno SL, R:R i wielkość pozycji. Warunki twarde wystarczy spełnić na jednym z poziomów, a karta oznacza, który je spełnia.

FVG pozostaje strefą wejścia do zamknięcia świecy po jego drugiej stronie. Pierwszy powrót do luki ma pełną punktację, kolejne niższą.

### 8.2 Stop loss

1. Kandydat A: za swingiem tworzącym setup (ekstremum sweepu) plus bufor.
2. Kandydat B: za FVG lub OB wejścia plus bufor.
3. Wybierz A. Jeśli A przekracza maksimum, sprawdź B. Jeśli oba przekraczają, odrzuć setup z powodem „SL powyżej maksimum”.

Bufor: 1 pips plus bieżący spread z ticków. Maksymalny SL: 20 pipsów dla par FX. Dla XAUUSD i WTI domyślnie skalowany do zmienności: taki sam ułamek średniego dziennego zakresu z 20 dni, jakim jest 20 pipsów dla EURUSD. Wyliczona wartość jest widoczna i edytowalna w ustawieniach instrumentu.

Dwie kontrole obowiązkowe:

- SL nie może leżeć w odległości do 2 pipsów od EQH/EQL ani innej oczywistej puli, bo to cel następnego sweepu. Przesuń SL za pulę, jeśli mieści się w maksimum. W przeciwnym razie ustaw flagę „SL przy płynności”.
- SL nie może stać tuż przed niewypełnionym PD array z H1 lub wyżej, do którego cena może wrócić. Ustaw flagę „SL przed PD array”.

### 8.3 Take profit

- TP1: pierwsza nietknięta pula płynności w kierunku transakcji, pomniejszona o margines 4 pipsów (parametr, zakres użytkownika 3–5).
- TP2: następna pula albo DOL dnia.
- R:R do TP1 musi wynosić co najmniej 2.0. Inaczej setup jest odrzucany z powodem „R:R poniżej 2”.
- Przeszkody: jeśli między wejściem a TP1 leży przeciwny PD array z H1 lub wyżej, pokaż go na karcie i obniż ocenę.

### 8.4 Ocena A/B/C

Na liście są wszyscy kandydaci, każdy z oceną. Etap „gotowy” wymaga warunków twardych: kompletny model, SL w granicy maksimum, R:R co najmniej 2, aktywne okno czasowe. Kandydat, który ich nie spełnia, dostaje etap „odrzucony” z powodem i jest domyślnie ukryty filtrem.

| Kryterium | Punkty |
| --- | --- |
| Zgodność z biasem D i H4 (zatwierdzonym albo wyliczonym z wysoką pewnością) | 20 |
| Jakość zebranej płynności. Najwyżej: EQH/EQL i swingi z H1 oraz poziomy zbieżne na kilku interwałach (H1+H4, D+H4+H1). Wysoko: high lub low sesji i PDH/PDL. Nisko: zwykły swing M15 | 15 |
| Siła displacementu i czysty FVG | 15 |
| Konfluencja wejścia z PD array wyższego interwału („60 FVG”, „240 FVG”, „D FVG”, OB) | 15 |
| Położenie: long w discount, short w premium zakresu H1 lub H4 | 10 |
| SMT divergence oraz spójność waluty, indeksu i obligacji (sekcja 7.4) | 10 |
| Czysta droga do TP1, bez przeciwnych PD arrays z H1 i wyżej | 10 |
| Brak danych high-impact w najbliższych 60 minutach | 5 |

Suma 100. A od 80, B od 60 do 79, C poniżej 60. Wagi i progi są edytowalne. Karta setupu zawsze pokazuje rozbicie punktów. To propozycja startowa: użytkownik dostroi ją po zebraniu statystyk z replay.

### 8.5 Pips i parametry instrumentu

FX: 0.0001, pary z JPY 0.01. Dla XAUUSD i WTI definicja pipsa i wielkość kontraktu różnią się między brokerami. Każdy instrument ma w ustawieniach: wielkość pipsa, wielkość kontraktu, maksymalny SL, margines TP, minimalne rozmiary FVG, tolerancję EQH/EQL.

### 8.6 Cykl życia sygnału

1. **Obserwacja.** Jest sweep w oknie, nie ma jeszcze MSS.
2. **Uzbrojony.** Jest MSS i strefa wejścia, cena poza strefą.
3. **Gotowy.** Cena w strefie wejścia, warunki twarde spełnione.
4. **Aktywny.** Poziom wejścia dotknięty (wejście symulowane).
5. **Zakończony.** TP1, TP2, SL, wygasł (koniec okna bez wejścia), unieważniony (cena, czas, zmiana biasu przez użytkownika) albo odrzucony (SL powyżej maksimum, R:R poniżej 2).

Ocena jest przeliczana przy każdej zmianie etapu. Jeden ruch rynku to jeden rekord: setup widziany na M5 i M15 scal w jeden sygnał. Wszystkie rekordy z historią etapów trafiają do bazy i są źródłem statystyk.

## 9. Newsy

Skaner pobiera kalendarz makro automatycznie i oznacza nim instrumenty. Nie blokuje sygnałów, bo zasada użytkownika zostawia mu ocenę sytuacji.

- **Źródło.** Endpoint EODHD `/economic-events`, jeśli plan użytkownika go obejmuje (test 4.1.6). Przy odmowie zaproponuj w planie inne źródło kalendarza dopuszczone do użytku osobistego. Niezależnie od źródła zostaw ręczne dodawanie i edycję wydarzeń.
- **Zakres.** Domyślnie główne publikacje dla USD i EUR: NFP, CPI, PPI, decyzje i konferencje FOMC oraz ECB, PKB, sprzedaż detaliczna, PMI i ISM. Lista jest edytowalna. Opcjonalnie waluty pozostałych instrumentów z listy. XAUUSD dziedziczy wydarzenia USD. WTI dziedziczy USD oraz tygodniowy raport EIA o zapasach ropy.
- **Dzień HIN.** Instrument z walutą, dla której są dziś dane high-impact, dostaje znacznik „dzień HIN”. Jego sygnały mają ostrzeżenie na karcie i korektę oceny o −15 punktów (parametr).
- **Okno publikacji.** 15 minut przed i 15 minut po publikacji (parametry) alerty dla tego instrumentu są wstrzymane, a kafelek pokazuje odliczanie do danych.
- **Cele na dane.** W dniu HIN pokaż na wykresie najbliższe niezebrane pule i niewypełnione PD arrays z wyższych interwałów po obu stronach ceny. To one mogą zostać zebrane podczas publikacji i to o nich mówi wyjątek w zasadzie użytkownika.
- **Czas.** Godziny wydarzeń przeliczaj z UTC na czas NY. Pasek kalendarza pokazuje dziś i jutro.

## 10. Interfejs

Skaner to nowa zakładka „Skaner” w dzienniku, w jego stylu wizualnym: nowoczesny wygląd zaawansowanego narzędzia tradingowego. Interfejs po polsku, terminy ICT po angielsku. Czas wszędzie nowojorski, z opcją pokazania czasu lokalnego obok.

### 10.1 Pulpit wielu wykresów (widok główny)

Siatka mini-wykresów świecowych, jeden kafelek na instrument, układ od 2×2 do 4×4 zależnie od liczby instrumentów. Interwał siatki przełączany globalnie: M5, M15, H1. Skaner pracuje na osobnym monitorze obok TradingView, więc projektuj pulpit pod pełny ekran i dużą gęstość informacji.

Na kafelku: symbol, cena, bias z ikoną nadpisania, aktywne okno czasowe, znacznik dnia HIN, ostrzeżenie o niepełnych danych, najwyższa ocena aktywnego sygnału i jego etap. Ramka kafelka podświetla się przy sygnale gotowym. Na mini-wykresie widać kluczowe pule i strefę wejścia aktywnego sygnału. Kliknięcie otwiera wykres szczegółowy.

### 10.2 Lista sygnałów (panel boczny)

Kolumny: czas, instrument, model, kierunek, etap, ocena, wejście, SL w pipsach, TP1, R:R, flagi. Filtry: minimalna ocena, model, instrument, etap, tylko zgodne z biasem. Domyślne sortowanie: gotowe na górze, potem według oceny.

### 10.3 Wykres szczegółowy

Przełączanie W, D, H4, H1, M15, M5 i M1, przesuwanie, zoom, kursor z ceną i czasem. Warstwy włączane osobno:

- FVG, z etykietami „D FVG”, „240 FVG”, „60 FVG” dla luk z wyższych interwałów widocznych na niższych,
- OB i breaker,
- pule płynności z etykietami (PDH, PDL, EQH, EQL, high i low sesji),
- sweepy, MSS i BOS,
- dealing range z equilibrium, OTE,
- poziomy otwarcia, NDOG i NWOG,
- tła killzone'ów i okien Silver Bullet,
- wydarzenia z kalendarza.

Kolory stref według konwencji użytkownika: zielone = spadkowe, burgundowe = wzrostowe, bez czerwonego (edytowalne). Aktywny setup jest narysowany: strefa wejścia, SL, TP1, TP2.

### 10.4 Karta setupu

- model i kierunek,
- opis krok po kroku, co się wydarzyło, z godzinami NY i cenami,
- wejście, SL, TP1, TP2, R:R do obu celów,
- rozbicie oceny na punkty,
- flagi: SL przy płynności, SL przed PD array, przeszkoda przed TP, dzień HIN, kontra do biasu, niepełne dane,
- poziom i czas unieważnienia,
- wielkość pozycji (sekcja 11),
- przycisk „Wyślij do dziennika”.

### 10.5 Panel bias

Tabela instrument × (W, D, H4, H1) z propozycją skanera, pewnością i powodami. Przyciski zatwierdzenia i nadpisania, pole DOL, przełącznik obligacji (7.4). Osobne wiersze dla syntetycznych DXY i EURX.

### 10.6 Pasek stanu

Zegar NY, aktywna sesja i odliczanie do następnego okna, status WebSocket, opóźnienie danych, zużycie limitu API i budżetu symboli, najbliższe dane makro.

### 10.7 Ustawienia

Lista instrumentów (dodawanie z listy symboli EODHD, parametry instrumentu), okna czasowe, parametry detektorów, wagi oceny, konto i ryzyko, alerty, klucz API, kolory, cena bid lub mid.

### 10.8 Wyślij do dziennika

Tworzy wpis w istniejącym formacie dziennika z wypełnionymi polami (instrument, kierunek, model, poziomy, ocena) i zrzutem wykresu skompresowanym tak, jak dziennik kompresuje screeny.

Wpis zapisuje identyfikator sygnału, z którego powstał. Powiązanie działa w obie strony: z wpisu można otworzyć kartę setupu, a z karty setupu wpis w dzienniku. Jeśli format dziennika wymaga nowego pola, dodaj je migracją z kopią zapasową tak, żeby starsze wpisy pozostały poprawne.

### 10.9 Biblioteka wykresów

Dobierz do stosu dziennika. Dla technologii webowych: TradingView Lightweight Charts. Dla innych: najlepszy odpowiednik. Wymóg: płynna praca 16 wykresów aktualizowanych na żywo.

### 10.10 Oceny użytkownika

- Na karcie setupu trzy przyciski: „dobry”, „zły”, „nie wziąłbym”. Do tego powód z krótkiej, edytowalnej listy (np. zły bias, słaby displacement, mało istotna płynność, za późno w oknie, przeszkoda przed TP) i pole notatki.
- Na wykresie szczegółowym akcja „zgłoś pominięty setup”: użytkownik zaznacza czas, kierunek i model, którego skaner nie wykrył. Skaner zapisuje zgłoszenie razem ze stanem detektorów z tej chwili, żeby dało się ustalić, który warunek nie został spełniony.
- Oceny działają tak samo na żywo i w replay. Trafiają do bazy razem z sygnałem.

### 10.11 Briefing dnia

Ekran otwierany na start doby handlowej i na żądanie. Dla każdego instrumentu pokazuje:

- bias W, D, H4 i H1 z pewnością oraz DOL,
- najbliższe pule płynności po obu stronach ceny, z rangą,
- niewypełnione PD arrays z H1 i wyżej oraz położenie w dealing range,
- stan spójności waluty, indeksu i obligacji,
- publikacje HIN danego dnia w czasie NY.

Przycisk „Kopiuj jako tekst” tworzy zwięzły skrót po polsku, po trzy linijki na instrument: bias, kluczowe poziomy, otwarte scenariusze.

## 11. Alerty i wielkość pozycji

### 11.1 Alerty

Dwa niezależne przełączniki globalne: dźwięk (włączony lub wyłączony) oraz powiadomienie Windows (włączone lub wyłączone). Oba dostępne jednym kliknięciem z paska stanu, nie tylko w ustawieniach.

- Minimalna ocena dla alertu: domyślnie B.
- Etapy, które alarmują: domyślnie „gotowy”, opcjonalnie „uzbrojony”.
- Wyciszenie per instrument i szybkie „wycisz wszystko na 1 godzinę”.
- Osobny dźwięk dla oceny A.
- Jeden alert na etap sygnału, bez powtórek.
- Treść powiadomienia: instrument, model, kierunek, ocena, wejście, SL, TP1, R:R. Kliknięcie otwiera kartę setupu.
- W oknie publikacji danych alerty są wstrzymane (sekcja 9).

Cel użytkownika to 4–8 alertów dziennie łącznie. Jeśli replay na domyślnych progach daje wyraźnie więcej albo mniej, pokaż to w raporcie fazy i zaproponuj korektę progów.

### 11.2 Wielkość pozycji

Ustawienia konta: kapitał, waluta konta, ryzyko na transakcję w procentach, krok lota. Konto użytkownika jest w PLN, więc dodaj USDPLN do subskrypcji i przeliczaj wartość pipsa przez USD. Karta setupu pokazuje ryzyko w walucie konta, wielkość w lotach zaokrągloną w dół do kroku oraz wartość pipsa.

Wartość pipsa przeliczaj na walutę konta po bieżącym kursie ze strumienia. Jeśli potrzebna jest dodatkowa para przeliczeniowa, dodaj ją do subskrypcji. Dla XAUUSD i WTI używaj wielkości kontraktu z ustawień instrumentu. Gdy brakuje danych do przeliczenia, pokaż to na karcie zamiast zgadywać.

## 12. Replay i statystyki

### 12.1 Replay

Użytkownik wybiera instrumenty i zakres dat, a skaner odtwarza historię świeca po świecy z M1, z regulacją prędkości, pauzą i krokiem. Pulpit, lista sygnałów i karty zachowują się jak na żywo.

- Replay używa tego samego potoku co tryb live. Różni je tylko źródło świec.
- Wynik replay dla danego dnia jest identyczny przy każdym uruchomieniu.
- Bias w replay jest wyliczany automatycznie. Zapisane nadpisania użytkownika z danego dnia są odtwarzane.
- Alerty dźwiękowe i powiadomienia w replay są domyślnie wyłączone.

### 12.2 Symulacja wyniku

- Wejście: dotknięcie poziomu wejścia, symulowane osobno dla krawędzi strefy i dla CE. Statystyki pokazują oba warianty.
- Wyjście: SL, TP1 lub TP2 według poziomów z karty. Wynik w R.
- SL i TP1 w tej samej świecy M1 liczone jako SL (wariant pesymistyczny).
- Spread: rzeczywisty z ticków w trybie live, stały parametr per instrument w replay.

### 12.3 Statystyki

Liczba sygnałów, odsetek dojścia do wejścia, win rate do TP1, średni R, expectancy, najdłuższa seria strat, MFE i MAE w R.

Podziały: model, instrument, okno czasowe, ocena (A, B, C), dzień tygodnia, zgodność z biasem, dzień HIN. Osobny widok „czy ocena działa”: porównanie wyników A, B i C. Eksport do CSV.

**Realne transakcje a symulacja.** Dla sygnałów powiązanych z wpisem w dzienniku pokaż obok siebie wynik symulowany i wynik realnej transakcji w R oraz różnicę między nimi. Pokaż też, jaki odsetek sygnałów A, B i C użytkownik faktycznie zagrał.

### 12.4 Uczciwość wyników

Pokaż na stałe informację, że to symulacja na danych EODHD bez poślizgu i że wyniki historyczne nie gwarantują przyszłych. Komórkę statystyk z mniej niż 30 sygnałami oznacz jako „za mała próba”. Nie dostrajaj parametrów automatycznie pod wynik: strojenie należy do użytkownika.

### 12.5 Pętla ocen i kalibracja

Skaner nie uczy się sam. Oceny użytkownika i wyniki symulacji zasilają raport, na podstawie którego użytkownik ręcznie zmienia parametry.

- **Raport kalibracji.** Dla każdego kryterium oceny z sekcji 8.4: średni wynik w R i odsetek ocen „dobry” przy spełnionym i niespełnionym kryterium. Dla każdego progu detektora: liczba sygnałów ocenionych jako „zły” z danym powodem. Dla zgłoszeń pominiętych setupów: który warunek najczęściej blokował wykrycie.
- **Zgodność z użytkownikiem.** Odsetek sygnałów A, B i C ocenionych jako „dobry” oraz liczba pominiętych setupów na tydzień.
- **Okres strojenia i okres sprawdzianu.** Użytkownik wybiera datę podziału, domyślnie 2/3 historii na strojenie i ostatnia 1/3 na sprawdzian. Statystyki pokazują oba okresy obok siebie. Zmianę parametrów ocenia się na okresie sprawdzianu, którego strojenie nie widziało.
- **Zestawy parametrów.** Zapis nazwanych zestawów parametrów i porównanie dwóch zestawów na tym samym okresie.
- **Mała próba.** Przy mniej niż 30 ocenionych sygnałach w komórce raport pokazuje „za mała próba”.

## 13. Wymagania niefunkcjonalne, testy, bezpieczeństwo

### 13.1 Testy

- **Detektory.** Testy jednostkowe każdego detektora na ręcznie przygotowanych sekwencjach świec: przypadek pozytywny, negatywny i brzegowy.
- **Agregacja świec.** Granica 17:00 NY, zmiana czasu w USA w marcu i listopadzie, tygodnie, gdy USA i Europa są w różnych fazach czasu letniego, otwarcie niedzielne.
- **Brak zaglądania w przyszłość.** Wynik detektora na świecach 1..n nie zmienia się po dodaniu świecy n+1, poza obiektami, które z definicji czekają na potwierdzenie.
- **Zgodność live i replay.** Ten sam dzień przetworzony na żywo i w replay daje te same sygnały.
- **Test złoty.** Użytkownik wskaże 3–5 dni historycznych, w których sam widział setup. Skaner musi go wykryć z poziomami zbliżonymi do jego oznaczeń. Różnicę wynikającą z feedu udokumentuj.

### 13.2 Wydajność i odporność

- Detektory przeliczane przyrostowo przy zamknięciu świecy, nie od zera.
- Płynny interfejs przy 16 wykresach i około 25 strumieniach. Start z cache poniżej 10 sekund.
- Obsłużone stany: brak internetu, odpowiedzi 401, 403 i 429, wyczerpany limit dzienny, weekend (czytelny stan „rynek zamknięty”, nie błąd), uśpienie i wybudzenie komputera z uzupełnieniem luki.
- Logi diagnostyczne do pliku z rotacją, bez klucza API.

### 13.3 Dane i wiele komputerów

- Dane dziennika pozostają nienaruszone. Migracje tylko z kopią zapasową.
- Ustawienia skanera, nadpisania biasu i historia sygnałów podróżują między komputerami tak jak reszta danych dziennika. Klucz API i cache świec zostają lokalnie.
- Jeden klucz API na dwóch komputerach jednocześnie dzieli limit 50 symboli. Wykryj odmowę „Symbols limit reached” i pokaż zrozumiały komunikat.

### 13.4 Build i dokumentacja

- Ten sam proces budowania .exe co dziennik. Użytkownik pobiera plik z automatycznego buildu na GitHubie. Ustal w kroku 1, jak ten build działa, i zadbaj, żeby uruchamiał się także dla gałęzi roboczej, tak aby przy każdym przystanku użytkownik mógł pobrać wersję testową. Jeśli push ze zmianą pliku workflow zostanie odrzucony, podaj użytkownikowi gotową treść do wklejenia na GitHubie.
- `docs/skaner/README.md` po polsku dla użytkownika: jak czytać sygnał, co znaczą flagi i etapy, jak stroić parametry, jak działa replay.
- `docs/skaner/definicje.md`: definicje detektorów z parametrami w wersji zaimplementowanej.
- `docs/skaner/decyzje.md`: założenia przyjęte w trakcie budowy.

Wynikiem pracy jest gałąź `feature/skaner-ict` i pull request z opisem zmian. Nie twórz tagów ani wydań: nową wersję wydaje użytkownik po połączeniu zmian.

## 14. Kryteria odbioru

Praca jest skończona, gdy wszystkie punkty są spełnione, a raport końcowy opisuje każde odstępstwo od tej specyfikacji z powodem.

- [ ] Zakładka „Skaner” działa w dzienniku, a istniejące funkcje dziennika działają jak wcześniej.
- [ ] Strumień live działa dla wszystkich instrumentów potwierdzonych w teście wykonalności. Status połączenia jest widoczny, a luki w danych są oznaczane.
- [ ] Świece H4, D i W są cięte w granicy 17:00 NY. PDH i PDL zgadzają się z TradingView (OANDA) w granicach zmierzonej różnicy feedu.
- [ ] Cztery modele są wykrywane na żywo i w replay, z etapami i oceną A/B/C z rozbiciem punktów.
- [ ] Każdy sygnał gotowy ma SL w granicy maksimum, R:R do TP1 co najmniej 2 oraz jawne unieważnienie cenowe i czasowe.
- [ ] Panel bias pokazuje propozycję z powodami i pozwala ją nadpisać.
- [ ] Syntetyczne DXY i EURX są liczone na żywo, a SMT wpływa na ocenę.
- [ ] Kalendarz makro oznacza dni HIN i wstrzymuje alerty w oknie publikacji.
- [ ] Dźwięk i powiadomienia Windows mają osobne przełączniki.
- [ ] Karta setupu liczy wielkość pozycji z ustawień konta.
- [ ] Replay jest deterministyczny, statystyki liczą się i eksportują do CSV, a oceny użytkownika zasilają raport kalibracji.
- [ ] Testy przechodzą, .exe się buduje, dokumentacja w `docs/skaner/` jest kompletna.

## 15. Założenia do potwierdzenia z użytkownikiem

Zadaj te pytania w planie (krok 2). Do czasu odpowiedzi stosuj wartość z tej specyfikacji.

1. Wielkość pipsa i wielkość kontraktu dla XAUUSD i WTI oraz potwierdzenie wyliczonego maksymalnego SL.
2. Kapitał, ryzyko na transakcję i krok lota u brokera (waluta konta: PLN).
3. Cena bid czy mid do budowy świec, po wyniku testu zgodności.
4. Źródło WTI i kalendarza makro, jeśli test wykaże brak w planie EODHD.
5. Sposób zbierania danych w tle, jeśli REST intraday okaże się nieświeży (sekcja 4.5).
6. Które 3–5 dni historycznych mają trafić do testu złotego.
7. Lista powodów do przycisków oceny sygnału (sekcja 10.10).
