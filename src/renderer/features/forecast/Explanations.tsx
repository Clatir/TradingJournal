/** Formulas under the table (chapter 6.5). */
export function Explanations() {
  return (
    <ul className="flex list-disc flex-col gap-1 pl-4 text-[11.5px] text-muted" data-testid="fc-explanations">
      <li>
        <b className="text-fg">Wpłata</b> = dopłata co miesiąc (od 2. miesiąca) albo kwota wpisana w tabeli dla danego miesiąca. Kwota ujemna to wypłata z kapitału.
      </li>
      <li>
        <b className="text-fg">Kapitał na początku</b> = kapitał na koniec poprzedniego miesiąca + wpłata − podatek (w 1. miesiącu: kapitał na start + wpłata).
      </li>
      <li>
        <b className="text-fg">Zysk</b> w trybie procentowym = kapitał na początku × zwrot. W trybie pipsowym = pipsy × wartość pipsa × (lot ÷ najmniejszy lot); kolumna
        Zwrot pokazuje, jaki to procent kapitału.
      </li>
      <li>
        <b className="text-fg">Wypłata</b> = procent wypłaty × zysk. W miesiącu ze stratą wypłaty nie ma.
      </li>
      <li>
        <b className="text-fg">Kapitał na koniec</b> = kapitał na początku + zysk − wypłata.
      </li>
      <li>
        <b className="text-fg">Gotówka</b>: wypłaty leżą poza kontem i nie zarabiają. Maleją tylko o kwoty celów.
      </li>
      <li>
        <b className="text-fg">Fundusz celowy</b>: odkładanej wypłaty nie wypłacasz, więc zostaje w masie obrotowej i od następnego miesiąca pracuje razem z kapitałem.
        Zysk liczy się od całej masy, a jego procent wypłaty dopisuje się do funduszu. Fundusz = suma odłożonych wypłat − kwoty celów. Masa obrotowa na koniec = masa
        na początku + zysk − kwoty celów.
      </li>
    </ul>
  )
}
