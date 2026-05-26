// Sdílené menu pro pokladnu (bukovar-pokladna.html) a mobilního číšníka (cisnik.html).
// Single source of truth — při změnách piv/cen/položek upravit jen tady.
// Načítá se přes <script src="menu.js"></script> před hlavním scriptem.

const MENU = [
  {n:"Radler",c:"Piva",p:49,u:"0,4l"},
  {n:"Birel nealko neochucený",c:"Piva",p:49,u:"0,5l"},
  {n:"Birel nealko ochucený",c:"Piva",p:49,u:"0,5l"},
  {n:"Maisel's Weisse Alkoholfrei",c:"Piva",p:65,u:"0,5l"},
  {n:"Pivo s sebou do džbánku 2l",c:"Piva",p:196,u:"2l"},
  {n:"Pivo s sebou do džbánku 5l",c:"Piva",p:490,u:"5l"},
  {n:"Espresso",c:"Horké nápoje",p:49},
  {n:"Espresso Lungo",c:"Horké nápoje",p:49},
  {n:"Doppio",c:"Horké nápoje",p:55},
  {n:"Cappuccino",c:"Horké nápoje",p:65},
  {n:"Latté Macchiato",c:"Horké nápoje",p:65},
  {n:"Flat white",c:"Horké nápoje",p:65},
  {n:"Čaj Ahmad Tea",c:"Horké nápoje",p:39},
  {n:"Turecká káva",c:"Horké nápoje",p:39},
  {n:"Ledová káva",c:"Horké nápoje",p:75},
  {n:"Kofola 0,3l",c:"Nealkoholické nápoje",p:39},
  {n:"Kofola 0,5l",c:"Nealkoholické nápoje",p:49},
  {n:"Frizzante 0,3l",c:"Nealkoholické nápoje",p:39},
  {n:"Frizzante 0,5l",c:"Nealkoholické nápoje",p:49},
  {n:"Domácí limonáda 0,4l",c:"Nealkoholické nápoje",p:49,u:"0,4l"},
  {n:"Domácí limonáda 1l",c:"Nealkoholické nápoje",p:90,u:"1l"},
  {n:"Domácí limonáda 2l",c:"Nealkoholické nápoje",p:160,u:"2l"},
  {n:"Royal crown cola",c:"Nealkoholické nápoje",p:39},
  {n:"Targa Tonic",c:"Nealkoholické nápoje",p:39},
  {n:"Džus pomeranč",c:"Nealkoholické nápoje",p:39},
  {n:"Perlivá voda",c:"Nealkoholické nápoje",p:39},
  {n:"Bukovská voda",c:"Nealkoholické nápoje",p:0},
  {n:"Rozlévané víno",c:"Víno",p:69,u:"0,2l"},
  {n:"Vinný střik",c:"Víno",p:79,u:"0,3l"},
  {n:"Lahvové víno bílé",c:"Víno",p:299,u:"0,7l"},
  {n:"Lahvové víno bílé premium",c:"Víno",p:349,u:"0,7l"},
  {n:"Lahvové víno červené",c:"Víno",p:499,u:"0,7l"},
  {n:"Prosecco Mionetto",c:"Víno",p:299,u:"0,7l"},
  {n:"Prosecco Treviso",c:"Víno",p:199,u:"0,7l"},
  {n:"Prosecco rozlévané",c:"Víno",p:59,u:"0,15l"},
  {n:"Gin s tonikem",c:"Míchané nápoje",p:99,u:"0,3l"},
  {n:"Hugo Spritz",c:"Míchané nápoje",p:99,u:"0,3l"},
  {n:"Cuba libre",c:"Míchané nápoje",p:109,u:"0,3l"},
  {n:"Aperol Spritz",c:"Míchané nápoje",p:159,u:"0,3l"},
  {n:"Mojito",c:"Míchané nápoje",p:159,u:"0,3l"},
  {n:"Mimosa malá",c:"Míchané nápoje",p:59,u:"0,2l"},
  {n:"Mimosa velká",c:"Míchané nápoje",p:109,u:"0,4l"},
  {n:"Utopenec",c:"Občerstvení",p:85},
  {n:"Tlačenka ve skle",c:"Občerstvení",p:85},
  {n:"Pizza Della Casa",c:"Občerstvení",p:155},
  {n:"Nakládaný hermelín",c:"Občerstvení",p:85},
  {n:"Chipsy",c:"Občerstvení",p:59},
  {n:"Slané tyčinky",c:"Občerstvení",p:29},
  {n:"Křupky",c:"Občerstvení",p:29},
  {n:"Arašídy",c:"Občerstvení",p:39},
  {n:"Paštiky Čongrády",c:"Občerstvení",p:99},
  {n:"Paštika ve skle Čongrády",c:"Občerstvení",p:109},
  {n:"Škvarky v sádle Čongrády",c:"Občerstvení",p:139},
  {n:"Zákusek",c:"Občerstvení",p:65},
  {n:"Zákusek",c:"Občerstvení",p:85},
  {n:"Rum standard (Republica, Heffron...)",c:"Destiláty",p:79,u:"0,05l"},
  {n:"Rum premium (Kraken, Espero...)",c:"Destiláty",p:99,u:"0,05l"},
  {n:"Rum luxus (Don Papa, Diplomatico...)",c:"Destiláty",p:129,u:"0,05l"},
  {n:"Dárkové trojbalení",c:"Merch",p:320},
  {n:"Sklenice",c:"Merch",p:105}
];

const CAT_ORDER = ["Piva","Nealkoholické nápoje","Horké nápoje","Víno","Míchané nápoje","Občerstvení","Destiláty","Merch"];

// Čepovaná piva (sdílí pokladna i číšník — vlastní sekce nad standardním MENU)
const BEERS_CEP = [
  {n:'Hraďák 10°',     barva:'zelena'},
  {n:'Štamgast 11°',   barva:'hneda'},
  {n:'Šedá vlčice 11°', barva:'seda'},
  {n:'Kohoutí 12°',    barva:'zlata'},
  {n:'Zlatka 11°',     barva:'zluta'},
  {n:'Mezulánka 11°',  barva:'oranzova'},
  {n:'Nelson 12°',     barva:'modra'},
  {n:'Dublin 13°',     barva:'tmave-zelena'}
];
const CEP_PRICE = 49;
const CEP_VOLUME = '0,4l';
const PET_PRICE = 105;
const PET_VOLUME = '1,0l';

// Top 4 produkty pro mobilního číšníka — rychlá nabídka na home screen.
// Pokud bys chtěl změnit, uprav názvy (musí přesně sedět s MENU.n).
const TOP_4 = ['Radler', 'Birel nealko neochucený', 'Espresso', 'Targa Tonic'];
