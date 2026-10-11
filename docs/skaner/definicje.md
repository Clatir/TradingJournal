# Skaner ICT – definicje detektorów (wersja zaimplementowana, faza 2)

Stan po fazie 2 (11.10.2026). Opisuje to, co robi kod w `src/shared/scanner/detectors/` i `src/shared/scanner/engine.ts`,
a nie to, co mówi specyfikacja (sekcja 5) – różnice są wypisane w sekcji 9 i w `decyzje.md`. Parametry są w
`settings.scanner.detectors` (`detectors/params.ts`, zod z wartościami domyślnymi; błędna wartość wraca do domyślnej).
Jednostką odległości jest pips instrumentu (`pipSize` z `settings.scanner.instruments`, np. 0,0001 dla EURUSD, 0,01 dla
par z JPY, 0,1 dla XAUUSD). Czas = Unix w sekundach, świece są zamknięte; `t` = początek świecy, `end` = koniec.

## 1. Zasady wspólne

- **Jedna świeca na raz.** Silnik interwału (`IntervalEngine.push`) dostaje zamkniętą świecę i aktualizuje obiekty.
  Nic nie patrzy na świecę, która się nie zamknęła. Kolejność w `push`: postęp stanów istniejących obiektów → FVG →
  displacement → przerzut bloków → volume imbalance → swingi (z EQ i rejection) → struktura (MSS / BOS, OB, OTE) →
  dealing range → sweepy.
- **Wsadowo = przyrostowo.** `analyzeSeries` odtwarza świece wszystkich interwałów w kolejności czasu zamknięcia,
  przy równym czasie krótszy interwał pierwszy (M15 przed H1 przed H4 przed D). Wynik jest identyczny z podawaniem
  świec na żywo (test).
- **Brak zaglądania w przyszłość.** Każdy obiekt ma pola tożsamości (nigdy się nie zmieniają po powstaniu) i pola
  stanu, które tylko postępują (np. `open → touched → ce → filled → inverted`, znaczniki czasu z `null` na wartość).
  Test losowy: wynik po n świecach jest przedrostkiem wyniku po n+1 (`tests/unit/scanner-detectors.test.ts`).
- **Identyfikatory** deterministyczne: `<interwał>:<rodzaj>:<czas>` (np. `H1:fvg:1760342400`), niezależne od symbolu.
  Pole `createdAt` = czas świecy, która obiekt potwierdziła (dla swingu: N-ta świeca po prawej).
- **Interwały silnika:** M15, H1, H4, D (`ENGINE_INTERVALS`). M5 i M1 nie przechodzą przez detektory (paradygmat
  top-down: wejścia na H1 i M15, plan sekcja 14). W (tydzień) tylko jako źródło PWH/PWL.
- **Etykiety wyższych interwałów** w stylu TradingView: `60`, `240`, `D` (`INTERVAL_LABEL`), np. „240 FVG”, „D OB”,
  „60 swing H”.

## 2. Swingi i klasy

| Pojęcie | Implementacja | Parametr |
| --- | --- | --- |
| Swing high / low | Świeca, której high jest **ściśle** wyższy (low ściśle niższy) niż N świec po lewej i N po prawej. Równe ekstrema nie dają swingu. Powstaje przy zamknięciu N-tej świecy po prawej (`createdAt`), `at` = czas świecy swingu. | `swingN` = 1 (wszystkie interwały) |
| Klasa ST → IT | Swing wyższy (niższy) od **sąsiednich swingów tego samego rodzaju** po obu stronach. Ocena następuje, gdy pojawi się następny swing tego rodzaju (więc klasa IT jest znana z opóźnieniem jednego swingu; pole `cls` tylko rośnie). | – |
| Klasa IT → LT | To samo liczone wśród swingów IT. | – |
| Zebranie swingu | `takenAt` = czas świecy, której knot wyszedł za swing (przez pulę swingu albo przebicie struktury). | – |

Każdy swing tworzy **pulę płynności** rodzaju `SWING_H` (BSL) / `SWING_L` (SSL) z etykietą „60 swing H” itd.

## 3. Pule płynności, EQH / EQL, ranga

| Pula | Źródło | Kiedy powstaje / wygasa |
| --- | --- | --- |
| `SWING_H` / `SWING_L` | każdy swing interwału silnika | powstaje z swingiem; stan `taken` przy zebraniu |
| `EQH` / `EQL` | nowy swing i jeden z 5 poprzednich swingów tego rodzaju w odległości ≤ tolerancja; **żadna świeca między nimi** nie wyszła ponad poziom + tolerancja (poniżej − tolerancja). Poziom = bardziej skrajne z dwóch ekstremów. Jedna pula na nowy swing (najbliższy pasujący). | `eqTolerancePips`: M5 2, M15 2, H1 3, H4 5, D 5, W 5 |
| `PDH` / `PDL` | każda zamknięta świeca D (dzień handlowy 17:00 → 17:00 NY) | poprzednia wygasa (`expiredAt`) przy nowej |
| `PWH` / `PWL` | ekstrema świec D tygodnia; zamykane, gdy zamyka się ostatnia świeca tygodnia (pt 17:00 NY) albo przy pierwszej świecy nowego tygodnia (tydzień bez piątku) | jak wyżej |
| `PMH` / `PML` | ekstrema świec D miesiąca (miesiąc daty NY dnia handlowego); zamykane przy pierwszej świecy D nowego miesiąca | jak wyżej |
| `IPDA_H` / `IPDA_L` | ekstrema ostatnich 20, 40, 60 zamkniętych świec D; `at` = świeca ekstremum, `createdAt` = zamknięcie D; etykieta „IPDA 20d H” | przy każdej świecy D, o ile poziom lub świeca się zmieniły |
| `SESSION_H` / `SESSION_L` | high / low sesji z świec M15; sesja zamyka się, gdy koniec świecy ≥ koniec okna; etykiety „Asia H”, „London L”, „NY AM H” | `sessions`: Asia 20:00–00:00, London 02:00–05:00, NY AM 07:00–10:00 (NY) |

- Stany puli: `untouched` → `taken` (`takenAt`) albo `expired` (`expiredAt`, zastąpiona nowszą). Wygaśnięcie nie
  usuwa puli (historia na wykresie).
- Nie ma osobnego poziomu „niezebrane swingi H1 / H4 / D” – to pule `SWING_*` tych interwałów w stanie `untouched`.
- **Ranga** (`rankPools`, liczona przy zrzucie, nie per świeca): dla pul aktywnych (nie wygasłych) tej samej strony
  liczba **różnych interwałów źródła**, których poziom leży w odległości ≤ max(tolerancja EQ obu interwałów).
  Interwał źródła: M15 dla sesji, D dla PDH/PDL/PMH/PML/IPDA, W dla PWH/PWL, interwał silnika dla swingów i EQ.
  Ranga ≥ 2 → na wykresie etykieta „PDH ×2” i gruba linia.

## 4. Sweep

- Pula jest **zebrana** (`taken`), gdy knot świecy wychodzi za poziom o co najmniej `sweepMinPips` (0,5 p).
- **Sweep** powstaje, gdy ta sama świeca albo jedna z `sweepK` (3) kolejnych zamyka się z powrotem po wewnętrznej
  stronie poziomu. Brak powrotu w tym czasie = wybicie: pula zostaje zebrana, sweepu nie ma.
- Pola: `at` = pierwsza świeca za poziomem, `createdAt` = `closedBackAt` = świeca zamykająca z powrotem, `extreme` =
  najdalszy punkt za poziomem w tym czasie, `poolId`, `poolKind`, `side`, `level`.
- Każdy interwał silnika sprawdza **swoje pule i pule wszystkich innych źródeł** (inne interwały, poziomy dzienne,
  sesje); sweep jest oznaczony interwałem świec, które go zrobiły (`sweep.interval`). Ta sama pula może być zebrana
  tylko raz (stan), więc zbiera ją ten interwał, którego świeca zamknęła się pierwsza w kolejności odtwarzania
  (najkrótszy).

## 5. FVG, displacement, BPR, volume imbalance

| Pojęcie | Implementacja | Parametr |
| --- | --- | --- |
| FVG (BISI / SIBI) | Trzy świece: low trzeciej > high pierwszej (byczy) albo high trzeciej < low pierwszej (niedźwiedzi). `at` = `createdAt` = trzecia świeca. Poziomy `top`, `bottom`, `ce` (50 %), `sizePips`. | `fvgMinPips`: M5 1, M15 2, H1 4, H4 8, D 15, W 15 |
| Stany FVG | monotoniczne, każdy ze znacznikiem czasu: `touched` (knot dotknął bliższej krawędzi), `ce` (knot osiągnął CE), `filled` (knot przeszedł dalszą krawędź), `inverted` (**zamknięcie** za dalszą krawędzią). | – |
| Displacement | Przy powstaniu FVG: ciąg 1–3 świec w kierunku FVG kończący się na środkowej świecy FVG (albo trzeciej, gdy kontynuuje ciąg); środkowa świeca musi być w kierunku FVG. Suma korpusów ciągu ≥ m × średni korpus `lookback` świec przed ciągiem (min. 5 świec historii). Jeden displacement na świecę końcową i kierunek. `fvgId` = FVG, który go potwierdził. | `displacementM` = 2,0, `displacementLookback` = 20 |
| BPR | Nowy FVG nachodzi na wcześniejszy przeciwny FVG (z ostatnich 40, w dowolnym stanie – zwykle już odwrócony ruchem, który zrobił nowy). Strefa = część wspólna, `dir` = kierunek późniejszego FVG. | – |
| Volume imbalance | Korpusy dwóch sąsiednich świec nie nachodzą na siebie, a knoty tak. Rozmiar ≥ połowa minimum FVG. Stan `open` → `filled`, gdy knot przejdzie całą lukę. | – |

Liquidity void, Power of 3 i Judas swing **nie są** zaimplementowane w fazie 2 (etykiety dobowe – do fazy 3 przy biasie).

## 6. Struktura: MSS, BOS, order block, breaker, OTE

- **Przebicie struktury:** zamknięcie świecy powyżej **ostatniego nieprzebitego swing high** tego interwału (bycze)
  albo poniżej ostatniego swing low (niedźwiedzie). Przebity swing dostaje `takenAt`, a „ostatni swing” po tej stronie
  jest czyszczony do czasu powstania nowego.
- **MSS** = przebicie w kierunku **przeciwnym** do bieżącego trendu (`trend`, na starcie `null`, więc pierwsze
  przebicie w danych to MSS) **i** displacement w tym kierunku, którego ciąg skończył się najpóźniej 2 świece wcześniej
  (okno 3 świec). Przebicie bez displacementu nie daje zdarzenia (swing i tak jest oznaczony jako zebrany).
- **BOS** = przebicie w kierunku trendu; displacement **nie jest wymagany** (`displacementId` gdy był).
- Po zdarzeniu `trend` = jego kierunek.
- **Order block** (przy MSS albo BOS z displacementem): ostatnia świeca **przeciwna** w obrębie 10 świec przed ciągiem
  displacementu. Strefa = korpus (open–close), `mt` = 50 %. Jeden blok na świecę. Nieważny (`invalid`,
  `invalidatedAt`) po zamknięciu świecy za dalszą krawędzią (byczy: close < bottom).
- **Breaker / mitigation block:** unieważniony OB, przez który przeszedł displacement w przeciwną stronę (ciąg
  zakończony w oknie 3 świec od unieważnienia; sprawdzane także gdy FVG displacementu potwierdza się 1–2 świece
  później) **przerzuca się**: `kind` = `breaker`, gdy po powstaniu bloku był sweep strony, którą blok chronił (byczy
  OB → sweep BSL), inaczej `mitigation`; `dir` odwraca się, `state` = `valid`, `flippedAt`. Późniejsze zamknięcie przez
  przerzucony blok → `flipInvalidatedAt`.
- **OTE** (tylko przy MSS): noga od **ostatniego swingu drugiego rodzaju** (`legStart`, dla byczego MSS ostatni swing
  low) do ekstremum osiągniętego od tego swingu (`legEnd`, przesuwa się z nowymi ekstremami – pole stanu, poziomy
  liczone na nowo). Poziomy 62 / 70,5 / 79 % mierzone od końca nogi w stronę jej początku. Nieważny po zamknięciu za
  początkiem nogi; nowy MSS w drugą stronę unieważnia aktywne przeciwne OTE.
- **Rejection block** (przy potwierdzeniu swingu): knot po stronie swingu ≥ `rejectionWickRatio` (2) × max(korpus,
  1 pips) i ≥ 1 pips. Strefa od końca korpusu do końca knota, `dir` przeciwny do swingu (swing high → niedźwiedzi).
  Nieważny po zamknięciu za końcem knota.

## 7. Dealing range

Między ostatnim swing high i swing low interwału, **IT jeśli istnieje, inaczej ST**, rozszerzony o cenę, która od tego
czasu wyszła poza nie. `eq` = 50 %, `zone` = `premium`, gdy ostatnie zamknięcie ≥ EQ, inaczej `discount`. Liczony dla
każdego interwału silnika (także M15), aktualizowany co świecę (`updatedAt`).

## 8. Poziomy otwarcia, luki, okna

| Poziom | Implementacja |
| --- | --- |
| Midnight open | open pierwszej świecy M15 dnia kalendarzowego NY, o ile zaczyna się w pierwszej godzinie dnia (dane zaczynające się w środku dnia nie dają poziomu). Poprzedni wygasa. |
| 08:30 open | open pierwszej świecy M15 zaczynającej się w 08:30–09:29 NY. |
| Otwarcie tygodnia | open pierwszej świecy tygodnia (nd 17:00 NY): poprzednia świeca była w innym tygodniu albo świeca zaczyna się dokładnie o początku tygodnia. |
| NDOG | luka między zamknięciem świecy kończącej dzień handlowy (17:00 NY) a otwarciem następnej; ≥ 0,1 pips; aktywnych najwyżej 5 (starsze wygasają). Poziomy: granice i CE. |
| NWOG | jak NDOG, ale między ostatnią świecą tygodnia a pierwszą nowego; aktywne najwyżej 3. |

Okna (`windows.ts`, czas NY, start włącznie, koniec wyłącznie, okno przez północ gdy `to` ≤ `from`):

| Okno | Godziny | Użycie |
| --- | --- | --- |
| `windows` (killzone'y) | London KZ 02:00–04:40, NY KZ 07:00–10:00 | wejście musi być w oknie (faza 3); tło na wykresie M15 / H1 |
| `silverBullet` | SB 03:00–04:00 | model 3 (faza 3); ciemniejsze tło |
| `sessions` | Asia 20:00–00:00, London 02:00–05:00, NY AM 07:00–10:00 | pule sesji |

## 9. Warstwy na wykresie (`src/renderer/features/scanner/layers.ts`, `primitives.ts`)

Analiza liczona w oknie na żądanie (`analysis.ts`: świece M15 z 35 dni, H1 ze 130, H4 i D z 410, tylko zamknięte;
odświeżana przy zmianie symbolu, parametrów i danych oraz co 5 min; czas w pasku „analiza N ms”). Warstwy
przełączane przyciskami nad wykresem (zapamiętane w `localStorage`, klucz `ictj.scanner.layers`), licznik obiektów
w rogu wykresu.

| Warstwa | Co rysuje | Na którym interwale |
| --- | --- | --- |
| FVG | prostokąt od trzeciej świecy do odwrócenia albo wypełnienia (dalej w nieskończoność, gdy otwarty); etykieta „FVG”, „60 FVG”, „240 FVG”, „D FVG”, „(wyp.)” dla wypełnionych; odwrócony = przerywana ramka bez wypełnienia | obiekty tego i wyższych interwałów |
| OB | OB / breaker / MB (korpus) od świecy bloku (po przerzucie od `flippedAt`) do unieważnienia; BPR jako przerywana ramka | ten i wyższe |
| pule | linie poziome od `createdAt` do zebrania / wygaśnięcia; swingi tylko tego i wyższych interwałów i tylko nietknięte; wygasłe sesje i IPDA pomijane; etykieta z rangą „PDH ×2” (gruba, akcent) | wszystkie źródła |
| sweepy | strzałka przy świecy `at` z etykietą „sweep PDH” / „sweep Asia H” | tylko ten interwał |
| MSS / BOS | strzałka z etykietą przy świecy zamykającej (bycze pod świecą, bordowe; niedźwiedzie nad, zielone), kwadrat przy końcu displacementu | tylko ten interwał |
| DR / OTE | DR high / low / EQ (przerywane), strefa OTE 62–79 z linią 70,5 | tylko ten interwał (domyślnie wyłączona) |
| otwarcia | midnight open, 08:30 open, open tyg. (aktualne w akcencie, wygasłe przyciemnione), NDOG / NWOG jako szare prostokąty | wszystkie |
| okna | tła London KZ, NY KZ, SB (tylko w godzinach rynku) | M15 i H1 |
| swingi | kółka przy swingach: LT akcent, IT szare, ST przyciemnione (domyślnie wyłączona) | tylko ten interwał |

Kolory według konwencji użytkownika: **strefy niedźwiedzie zielone, bycze bordowe**; jeden akcent `#e8a33d` dla pul
z rangą, sweepów i aktualnych otwarć.

## 10. Różnice wobec specyfikacji (sekcja 5) i rzeczy odłożone

1. BOS nie wymaga displacementu; MSS bez displacementu nie jest zdarzeniem (spec: MSS „ruchem z displacementem” –
   zachowane; BOS spec nie precyzuje).
2. Sweep ma interwał świec, które go zrobiły; pulę może zebrać dowolny interwał silnika (spec nie precyzuje).
3. Dealing range liczony także dla M15 (spec: H1, H4, D) – bez kosztu, przyda się przy wejściach M15.
4. Przerzut OB w breaker / mitigation sprawdzany w oknie 3 świec od unieważnienia; breaker wymaga sweepu strony
   chronionej przez blok **po** jego powstaniu.
5. EQH / EQL: para swingów z ostatnich 5 tego rodzaju; poziom = bardziej skrajne ekstremum (spec: „co najmniej dwa”).
6. Klasa IT / LT znana z opóźnieniem jednego swingu (nie da się inaczej bez zaglądania w przyszłość).
7. Flaga `incomplete` (luka danych w oknie obiektu) **nie jest** ustawiana – luki są widoczne osobno na wykresie
   (znacznik „luka”). Do rozważenia w fazie 3 przy ocenie.
8. Liquidity void, PO3 / Judas – odłożone do fazy 3 (bias dnia).
9. M5 nie przechodzi przez detektory (paradygmat top-down, plan sekcja 14).
10. Analiza w fazie 2 działa w oknie (renderer) na żądanie; w fazie 3 ten sam kod idzie do wątku procesu głównego
    (sygnały na żywo).
