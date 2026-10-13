/* Nightloom game data: shifts, dreams and ingredients.
   Map legend: . floor, (space) open sky, b moonbeam bridge, C counter, S star shelf,
   W wool basket, M moon well, L loom, K kettle, J jar shelf, B wash basin,
   R return hatch, D dream chute, X bin. */

const CH = {'.':'floor',' ':'void','b':'bridge','C':'counter','S':'star','W':'wool','M':'moon','L':'loom','K':'kettle','J':'jars','B':'basin','R':'return','D':'chute','X':'bin'};

const DREAMS = {
  flying:   {name:'Flying',   items:['thread','star'],               color:'#aab8ff'},
  seaside:  {name:'Seaside',  items:['moondrop','moondrop','thread'], color:'#6fd8e0'},
  starfall: {name:'Starfall', items:['star','star','moondrop'],       color:'#f4c96b'},
  lullaby:  {name:'Lullaby',  items:['thread','thread','moondrop'],   color:'#f6a6c8'}
};

const ICOL = {thread:'#c7a8ff', star:'#f4c96b', moondrop:'#7fe0e6', wool:'#f2eefc'};

const ITEM_NAMES = {wool:'wool', thread:'thread', star:'star', moondrop:'moondrop'};

/* Moon thresholds come from tools/sim.mjs: two expert bots average about
   Dusk 360, Midnight 420, Gale 315, Witching Hour 330, Daybreak 385.
   One moon sits near a quarter of that, three moons near 80 percent. */
const LEVELS = [
  {id:'dusk', name:'Dusk',
   blurb:'The first sleepers are turning in. Learn the loop: Flit fetches stars, Bramble spins wool into thread, the kettle brews, a clean jar bottles the dream, the chute sends it down.',
   map:['CCSCCWCCKCKCDC',
        'C............C',
        'M............J',
        'C...CCLCC....C',
        'C...CCCCC....B',
        'X............R',
        'C............C',
        'CCCCCCCCCCCCCC'],
   p1:[2.5,6.5], p2:[11.5,6.5], dreams:['flying','seaside'],
   time:150, spawn:17, life:80, grace:11, jars:3, moons:[80,170,280], hints:true},

  {id:'midnight', name:'Midnight',
   blurb:'A strip of open sky splits the workshop. Bramble cannot cross it. Throw things over, or let Flit fly them.',
   map:['CCWCCLC  CSCDC',
        'C......  ....C',
        'M......  ....J',
        'C...CK.  ....C',
        'C...CK.  ....B',
        'X......  ....R',
        'C......  ....C',
        'CCCCCCC  CCCCC'],
   p1:[2.5,5.5], p2:[11.5,5.5], dreams:['flying','seaside','starfall'],
   time:165, spawn:15, life:75, grace:9, jars:3, moons:[100,220,340]},

  {id:'gale', name:'Gale',
   blurb:'Night winds blow through the open windows. Watch the streaks: a gust pushes light little Flit right across the room. Bramble hardly notices.',
   map:['CWCCCCKCKCCCSC',
        'C............C',
        'M....CCCC....J',
        'D....LCCK....C',
        'C....CCCC....B',
        'X............R',
        'CCCCCCCCCCCCCC'],
   p1:[2.5,4.5], p2:[11.5,4.5], dreams:['flying','seaside','lullaby'],
   time:165, spawn:14, life:72, grace:9, jars:3, moons:[80,170,260],
   wind:{calm:7, warn:1.5, gust:5, flit:2.4, bramble:.6}},

  {id:'witching', name:'Witching Hour',
   blurb:'A moonbeam bridge joins the two halves, but only while the moon is out. Dreams turn to nightmares faster now.',
   map:['CSCCKCKCCWCDCC',
        'C............C',
        'M............J',
        '      bb      ',
        '      bb      ',
        'C............C',
        'X.....L......B',
        'C............R',
        'CCCMCCKCCKCCCC'],
   p1:[3.5,6.5], p2:[10.5,1.5], dreams:['flying','seaside','starfall','lullaby'],
   time:180, spawn:13, life:68, grace:7, jars:4, moons:[90,180,270],
   bridge:{on:9, off:5}},

  {id:'daybreak', name:'Daybreak',
   blurb:'The last rush before sunrise. Two islands, a flickering bridge, every dream on the menu. Jars come back on the far side.',
   map:['CWCCLCC  CSCDC',
        'C......  ....C',
        'M......  ....J',
        'C...K..  ..K.C',
        'B......bb....C',
        'C...K..  ..K.R',
        'X......  ....C',
        'CCCCCCC  CCCCC'],
   p1:[2.5,4.5], p2:[11.5,4.5], dreams:['flying','seaside','starfall','lullaby'],
   time:200, spawn:11, life:62, grace:6, jars:4, moons:[100,210,320],
   bridge:{on:7, off:5}}
];
