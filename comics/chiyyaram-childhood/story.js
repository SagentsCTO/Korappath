// Shared by index.html (the comic reader, via ../viewer.js) and sheet.html (the one-page share image).
// wide: true marks the 16:9 panels that span two columns on the page.
// What the children call their grandfather. ⚠ Confirm with the family (Achachan / Appooppan / Muthachan…).
var GRANDPA = 'Achachan';

// The two children: the older brother (10) and the little sister (4).
var APPU = 'Appu';
var ACHU = 'Achu';

// Captions (ml / en) are VERBATIM from stories/chiyyaram-childhood.html. "…" marks words left out; nothing is reworded.
// Bubbles and narration are invented for the comic. In each panel the caption sits above the picture, bubbles below.
var PANELS = [
  { alt: 'Two children lying on a tiled floor at night, reading a stack of handwritten pages.',
    bubbles: [[APPU, 'This is ' + GRANDPA + "'s book. He's writing about when he was little."], [ACHU, 'Read it to me!']] },
  { alt: 'Golden ribbons of light rise from the pages and swirl around the amazed children.',
    bubbles: [[ACHU, APPU + '… the letters are flying!'], [APPU, 'Hold my hand, ' + ACHU + '!']] },
  { wide: true, alt: 'The two children on a ridge between misty paddy fields at sunrise, egrets nearby.',
    ml: 'ഞാൻ ജനിച്ചതും വളർന്നതും ചിയ്യാരം എന്നൊരു കുഗ്രാമത്തിലായിരുന്നു. കൊല്ലം 1945 സെപ്റ്റംബർ മാസം.',
    en: 'I was born and raised in a small village called Chiyyaram, in September of the year 1945.',
    bubbles: [[ACHU, 'Where are we?'], [APPU, 'I think… inside ' + GRANDPA + "'s book!"]] },
  { alt: 'A bare-chested village boy in half-trousers stops on the ridge, staring at the two children.',
    bubbles: [['Village boy', "Who are you? I've never seen you in Chiyyaram!"], [APPU + ' (whispering)', ACHU + '… I think that\'s ' + GRANDPA + '!', 'aside']] },
  { alt: 'Seen from behind, the village boy points ahead as the three children walk up the red-earth path towards the tiled gatehouse of the ancestral home, the house roof beyond.',
    ml: '…എന്റെ തറവാട് "കോരപ്പത്തു കളപ്പുരക്കൽ" ഞങ്ങളുടെ ഗ്രാമത്തിലും തൃശ്ശൂർ പരിസര പ്രദേശത്തും സാമാന്യം അറിയപ്പെട്ടിരുന്നതും…',
    en: '…my ancestral home, "Korappath Kalappurakkal," was reasonably well known in our village and the surrounding Thrissur area…',
    bubbles: [[APPU, 'Look at that big house!'], [ACHU, 'Is that where little ' + GRANDPA + ' lives?']] },
  { alt: 'Villagers wait on the wide wooden veranda while the three children peek from behind a pillar.',
    ml: 'നാട്ടിലുള്ളവർ അവരുടെ പ്രശ്നങ്ങൾക്കും പരിതാപങ്ങൾക്കും അത്താണിയായിആവശ്യക്കാരെല്ലാം കണ്ടിരുന്നതും വലിയമ്മാവനെ തന്നെ ആയിരുന്നു.',
    en: 'The people of the village saw him as their refuge for their troubles and grievances; everyone in need turned to my uncle himself.',
    bubbles: [[ACHU, 'Why are all these people here?'], ['Village boy', "They've come to see Valiyammavan. Everyone does."]] },
  { alt: 'The elder uncle sits calmly in a carved chair, listening to two farmers talking at once.',
    ml: '…ആവശ്യക്കാരെല്ലാം മിക്ക ദിവസങ്ങളിലും അമ്മാവന്റെ സന്നിധിയിൽ എത്തുമായിരുന്നു തീർപ്പുകൾക്കായി.',
    en: '…people in need would come to him on most days seeking resolutions.',
    bubbles: [[APPU + ' (whispering)', "He's listening to both of them at once.", 'aside'], [ACHU, 'Shhh, ' + APPU + '!']] },
  { alt: 'A smiling farmer offers a bunch of bananas; the uncle raises his palm, kindly refusing.',
    ml: 'ഒട്ടും പ്രതിഫലം പറ്റാതെ എല്ലാ തീർപ്പുകളും ഭംഗിയായി സന്ദർഭോചിതമായി അദ്ദേഹം നടത്തിയിരുന്നു.',
    en: 'Without accepting any payment at all, he carried out every resolution gracefully and appropriately to the situation.',
    bubbles: [[ACHU, 'He said no to the bananas!'], [APPU, 'He helps them for free.']] },
  { alt: 'Seen from behind on the red-oxide veranda, the children watch the uncle in white walk across the yard towards the gatehouse, under a black umbrella.',
    ml: 'ചില ദിവസങ്ങളിൽ അവർക്കു വേണ്ടിയോ അന്യർക്കു വേണ്ടിയോ അമ്മാവൻ കോടതിയിൽ ഹാജരാകാറും ഉണ്ടായിരുന്നു. കോടതിയിലും വലിയ മതിപ്പുണ്ടായിരുന്നു അദ്ദേഹത്തിന്റെ ഇടപെടലുകൾക്ക്.',
    en: 'On some days, my uncle would even appear in court, whether on their behalf or on behalf of others. Even in court, his interventions were held in great regard.',
    bubbles: [[ACHU, "Where's he going?"], [APPU, 'To court, to help someone.']] },
  { wide: true, alt: 'The three children, seen from behind, look out over wide green paddy fields and coconut groves.',
    ml: 'കുടുംബപരമായി ഞങ്ങൾക്ക് ധാരാളം വസ്തുവകകളും പാട്ടഭൂമികളും കൃഷിയിടങ്ങളും ചുറ്റിലും പരിസര പ്രദേശങ്ങളിലും ഉണ്ടായിരുന്നു.',
    en: 'As a family, we had a great deal of property, leased lands, and farmland in and around the surrounding areas.',
    bubbles: [[APPU, "All these fields were our family's?"], [ACHU, "It's so green!"]] },
  { alt: 'At sunset the light swirls again; the little sister gives the village boy a sweet as everyone waves goodbye.',
    bubbles: [[ACHU, 'Bye-bye, little ' + GRANDPA + '!'], ['Village boy (puzzled, waving)', 'Come back again!'], [APPU, "We'll come back, promise!"]] },
  { alt: 'Back home, the children burst in; their grandfather looks up from his writing and smiles.',
    bubbles: [[APPU, GRANDPA + '! We saw Valiyammavan! He wouldn\'t even take the bananas!'], [ACHU, 'And we saw you when you were little!']],
    narration: GRANDPA + ' looks up over his glasses, and smiles.',
    end: true }
];
