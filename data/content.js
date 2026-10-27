const SITE_DATA = {
  pharmacyTimeline: [
    {
      year: "1756",
      title: "Založení lékárny v Příboře",
      person: "Václav Pokorný (1. generace)",
      description: "Založení lékárny „U Panny Marie pomocné“ v Příboře. Rodové heslo „Poctivost a práce“ se stává základem více než dvousetleté tradice v regionu silně ovlivněném působením piaristů."
    },
    {
      year: "19. století",
      title: "Generační kontinuita a rozkvět",
      person: "Kajetán, Ludvík a Ferdinand Pokorní (2.–4. generace)",
      description: "Rodina upevňuje postavení lékárny a aktivně se zapojuje do vlasteneckého a občanského života. Podílejí se na založení reálného gymnázia v Příboře a přispívají do Vlastivědy Novojičínska. Ferdinand sepisuje rodinnou kroniku Pokorných."
    },
    {
      year: "1. pol. 20. stol.",
      title: "První republika a spojení s rodem Brožíků",
      person: "Vladimír Pokorný (5. generace)",
      description: "Lékárnu přebírá Vladimír Pokorný. Sňatkem s Boženou Brožíkovou se rod spojuje se slavnou plzeňskou karosářskou rodinou „Brožík a syn“, staviteli prvního českého automobilu."
    },
    {
      year: "1945–1950",
      title: "Šestá generace a znárodnění",
      person: "PhMr. Václav Pokorný (6. generace)",
      description: "Po studiích farmacie v Praze a návratu do Příbora přebírá štafetu Václav Pokorný. V roce 1950 však přichází komunistické znárodnění, které násilně přerušuje rodinnou správu lékárny."
    },
    {
      year: "Po roce 1989",
      title: "Privatizace a zánik lékárny",
      person: "Pavel Grodza & závěr historie",
      description: "Po sametové revoluci prochází lékárna privatizací (Pavel Grodza). Přes snahy o udržení provozu historická lékárna „U Panny Marie pomocné“ v Příboře nakonec zaniká."
    }
  ],

  vaclavTimeline: [
    {
      period: "Mládí v Příboře",
      title: "Studia a první hudební kroky",
      description: "Vyrůstá v Příboře, kde studuje na místním gymnáziu. Jeho spolužákem a přítelem je Zdeněk Petr, rovněž budoucí významný hudební skladatel. Zde se formuje jeho hluboký vztah ke swingu a jazzu."
    },
    {
      period: "1939–1945",
      title: "Praha, farmacie a zlatá éra swingu",
      description: "Odchází do Prahy studovat farmacii. Během událostí 2. světové války naplno rozvíjí svůj hudební talent – spolupracuje s nakladatelstvím R. A. Dvorského a skládá slavné swingové písně."
    },
    {
      period: "1945–1948",
      title: "Návrat do Příbora a Divotvorný hrnec",
      description: "Po konci války se vrací do rodného Příbora, žení se a zapojuje se do kulturního života, mimo jiné nastudováním slavného muzikálu Divotvorný hrnec."
    },
    {
      period: "50. léta",
      title: "Znárodnění a stěhování",
      description: "Změna politického režimu po roce 1948 těžce zasahuje rodinu Pokorných. Po znárodnění lékárny následuje stěhování do Opavy a následně do Prahy. Vychovává děti Annu, Petra a Kateřinu."
    },
    {
      period: "60. léta",
      title: "Politické uvolnění a velké orchestry",
      description: "V atmosféře uvolnění 60. let spolupracuje se špičkovými kapelníky Karlem Vlachem a Karlem Krautgartnerem. Jeho syn Petr se v této době věnuje nastupujícímu big beatu."
    },
    {
      period: "1968–1989",
      title: "Normalizace a aranžérská preciznost",
      description: "Po srpnové invazi 1968 a nástupu normalizace se věnuje aranžérské práci pro vokální sbory a dechové orchestry. Spolupracuje se souborem Eva Kvartet (Vlaďka Hořovská)."
    },
    {
      period: "Po roce 1989",
      title: "Návrat ke kořenům, Semafor a rozhlas",
      description: "Po úmrtí manželky pokračuje v hudební činnosti. Spolupracuje s Václavem Markem, vzniká album „Několik přání“ spojené s divadlem Semafor a poskytuje řadu vzpomínkových rozhovorů pro Československý rozhlas."
    },
    {
      period: "2011 – současnost",
      title: "Odkaz v nových nahrávkách",
      description: "PhMr. Václav Pokorný umírá v roce 2011. Jeho písně však žijí dál – do svého repertoáru je zařazuje zpěvačka Dája Šimíčková a kapela Shadde Yadda, které pořizují nové nahrávky."
    }
  ],

  audioTracks: [
    {
      id: "track-1",
      title: "Ukázka z alba Několik přání (Semafor)",
      subtitle: "PhMr. Václav Pokorný & Václav Marek",
      duration: "3:15",
      src: "assets/audio/nekolik-prani-ukazka.mp3",
      year: "90. léta"
    },
    {
      id: "track-2",
      title: "Swingová kompozice (R. A. Dvorský edice)",
      subtitle: "Archivní nahrávka / Reinterpretace Shadde Yadda",
      duration: "2:50",
      src: "assets/audio/swing-ukazka.mp3",
      year: "1943 / 2012"
    },
    {
      id: "track-3",
      title: "Rozhovor pro Československý rozhlas",
      subtitle: "Vzpomínky na Příbor, farmacii a R. A. Dvorského",
      duration: "5:42",
      src: "assets/audio/rozhovor-rozhlas.mp3",
      year: "Archiv ČRo"
    }
  ],

  familyTree: {
    pharmacistsLine: [
      { gen: 1, name: "Václav Pokorný", role: "Zakladatel lékárny (1756)" },
      { gen: 2, name: "Kajetán Pokorný", role: "Lékárník v Příboře" },
      { gen: 3, name: "Ludvík Pokorný", role: "Lékárník a měšťan" },
      { gen: 4, name: "Ferdinand Pokorný", role: "Lékárník, autor rodinné kroniky" },
      { gen: 5, name: "Vladimír Pokorný", role: "Lékárník, manžel Boženy Brožíkové" },
      { gen: 6, name: "PhMr. Václav Pokorný", role: "Lékárník a swingový skladatel (zemř. 2011)" }
    ],
    brozikConnection: {
      title: "Větev Brožíkových z Plzně",
      spouse: "Božena Brožíková (provd. Pokorná)",
      details: "Pocházela ze slavné plzeňské rodiny karosářů „Brožík a syn“, kteří stáli u zrodu prvního českého automobilu a patřili ke špičce rakousko-uherského kočárnického průmyslu."
    },
    modernGenerations: [
      {
        generationTitle: "5. generace (Rodiče Václava)",
        members: ["Vladimír Pokorný", "Božena Pokorná (roz. Brožíková)"]
      },
      {
        generationTitle: "6. generace (Sourozenci)",
        members: ["PhMr. Václav Pokorný", "Božena", "Vladimír Pokorný ml."]
      },
      {
        generationTitle: "7. generace (Děti Václava a Vladimíra)",
        members: ["Anna", "Jitka", "Petr (hudebník – big beat)", "Lenka", "Kateřina"]
      },
      {
        generationTitle: "8. generace (Vnoučata Václava Pokorného)",
        members: ["Martin", "Kateřina", "Růžena", "Klára", "Jiří"]
      },
      {
        generationTitle: "9. generace (Nejmladší generace)",
        members: ["Jakub", "Anna", "Eliška", "Alžběta", "Barbora", "Celestýna", "Matěj", "Alžběta"]
      }
    ]
  },

  archiveItems: [
    {
      id: "doc-1",
      category: "kroniky",
      title: "Kronika rodu Pokorných",
      date: "19. století",
      author: "Ferdinand Pokorný",
      description: "Rukopisná kronika mapující počátky lékárny „U Panny Marie pomocné“ od roku 1756, působení piaristů v Příboře a založení reálného gymnázia.",
      transcription: "„Leta Páně 1756 předek náš Václav Pokorný lékárnu v Příboře založil s heslem Poctivost a práce...“",
      placeholderType: "chronicle"
    },
    {
      id: "doc-2",
      category: "dokumenty",
      title: "Lékárnický diplom – PhMr. Václav Pokorný",
      date: "40. léta 20. století",
      author: "Univerzita Karlova v Praze",
      description: "Oficiální diplom magistra farmacie udělený Václavu Pokornému v Praze.",
      transcription: "Diplom udělující titul PhMr. (Pharmaciae Magister).",
      placeholderType: "diploma"
    },
    {
      id: "doc-3",
      category: "noty",
      title: "Partitura a tisk nakladatelství R. A. Dvorský",
      date: "1942–1945",
      author: "Václav Pokorný",
      description: "Původní notový tisk swingové skladby vydaný v pražském nakladatelství R. A. Dvorského během 2. světové války.",
      transcription: "Hudba: Václav Pokorný. Vydal R. A. Dvorský, Praha.",
      placeholderType: "sheetmusic"
    },
    {
      id: "doc-4",
      category: "fotografie",
      title: "Historické průčelí lékárny U Panny Marie pomocné",
      date: "cca 1925",
      author: "Rodinný archiv Příbor",
      description: "Dobová fotografie příborské lékárny za působení páté generace (Vladimír Pokorný).",
      transcription: "Zadní strana fotografie: „Lékárna na náměstí v Příboře, léto 1925.“",
      placeholderType: "photo"
    },
    {
      id: "doc-5",
      category: "fotografie",
      title: "Továrna Brožík a syn v Plzni",
      date: "Počátek 20. století",
      author: "Archiv rodiny Brožíkových",
      description: "Fotografie karosářské dílny rodiny Boženy Brožíkové v Plzni.",
      transcription: "Karosárna a továrna na vozy Václav Brožík a syn, Plzeň.",
      placeholderType: "photo"
    },
    {
      id: "doc-6",
      category: "dokumenty",
      title: "Divadelní program: Divotvorný hrnec v Příboře",
      date: "1947",
      author: "Kulturní spolek Příbor",
      description: "Dobový program a poznámky k poválečnému uvedení hry Divotvorný hrnec po návratu Václava Pokorného do Příbora.",
      transcription: "Hudební nastudování a doprovod: PhMr. Václav Pokorný.",
      placeholderType: "document"
    }
  ]
};
