// Bundled snapshot of ERA team data + roster lookups. Player names/boosts come
// from the live RL bridge at runtime; this snapshot provides team names, logos,
// and slot ordering so the picker and graphics work offline.

const TEAM_DATA = [
  { code:'berk',   gm:'Tarry', leagues:[
    { name:'Night Furies', org:'The Berk',        logo:'images/Champion/night_furies.png' },
    { name:'Light Furies', org:'Vanaheim',        logo:'images/Major/light_furies.png' },
    { name:'Rumblehorns',  org:"Dragon's Edge",   logo:"images/Minor/Dragon's Edge Rumblehorns.png" },
    { name:'Zipplebacks',  org:'Forbidden Isle',  logo:'images/Academy/Forbidden Isle Zipplebacks.png' },
  ]},
  { code:'qc',     gm:'MiniMedic', leagues:[
    { name:'Monarchs',  org:'Queen City', logo:'images/Champion/QC Monarch.png' },
    { name:'Knights',   org:'Queen City', logo:'images/Major/QC Knights.png' },
    { name:'Squires',   org:'Queen City', logo:'images/Minor/QC Squires.png' },
    { name:'Commoners', org:'Queen City', logo:'images/Academy/QC Commoners.png' },
  ]},
  { code:'bamboo', gm:'JugPanda', leagues:[
    { name:'Bamboo Blackout', org:'Panda Syndicate', logo:'images/Champion/Bamboo Blackout.png' },
    { name:'Bamboo Blitz',    org:'Panda Syndicate', logo:'images/Major/Bamboo Blitz.png' },
    { name:'Bamboo Bloom',    org:'Panda Syndicate', logo:'images/Minor/Bamboo Bloom.png' },
    { name:'Bamboo Bud',      org:'Panda Syndicate', logo:'images/Academy/Bamboo Bud.png' },
  ]},
  { code:'suit',   gm:'Solurr', leagues:[
    { name:'Supernova', org:'Suitland',     logo:'images/Champion/Suitland Supernova.png' },
    { name:'Stars',     org:'Silver Spring', logo:'images/Major/Silver Spring Stars.png' },
    { name:'Cosmos',    org:'Columbia',      logo:'images/Minor/Columbia Cosmos.png' },
    { name:'Nebula',    org:'New Market',    logo:'images/Academy/New Market Nebula.png' },
  ]},
  { code:'leeds',  gm:'Precons', leagues:[
    { name:'Lightning', org:'Leeds',   logo:'images/Champion/Leeds Lightning.png' },
    { name:'Blizzards', org:'Bristol', logo:'images/Major/Bristol Blizzards.png' },
    { name:'Glacier',   org:'Glasgow', logo:'images/Minor/Glascow Glacier.png' },
    { name:'Ospreys',   org:'Oxford',  logo:'images/Academy/Oxford Ospreys.png' },
  ]},
  { code:'mont',   gm:'KingMoroz', leagues:[
    { name:'Rebels',        org:'Montgomery',   logo:'images/Champion/Montgomery Rebels.png' },
    { name:'Conquistadors', org:'Childersburg', logo:'images/Major/Childersburg Conquistadors.jpeg' },
    { name:'Militia',       org:'Mobile',       logo:'images/Minor/Mobile Militia.png' },
    { name:'Red Sticks',    org:'Tallapoosa',   logo:'images/Academy/Tallapoosa Red Sticks.jpeg' },
  ]},
  { code:'vb',     gm:'Souls', leagues:[
    { name:'Tides',    org:'Virginia Beach', logo:'images/Champion/Virgnia Beach Tides.png' },
    { name:'Admirals', org:'Arlington',      logo:'images/Major/Arlginton Admirals.png' },
    { name:'Captains', org:'Chesapeake Bay', logo:'images/Minor/Chesapeake Bay Captains.png' },
    { name:'Fleet',    org:'Norfolk',        logo:'images/Academy/Norfolk Fleet.png' },
  ]},
  { code:'osaka',  gm:'Chrome Moisty', leagues:[
    { name:'Revenants', org:'Osaka',    logo:'images/Champion/Osaka Revenants.png' },
    { name:'Wraiths',   org:'Tokyo',    logo:'images/Major/Tokyo Wraiths.png' },
    { name:'Yokais',    org:'Yokohama', logo:'images/Minor/Yokohama Yokais.png' },
    { name:'Hollows',   org:'Kyoto',    logo:'images/Academy/Kyoto Hollows.png' },
  ]},
];

const LEAGUE_KEYS = ['league1','league2','league3','league4'];
const LEAGUE_LABELS = { league1:'Champion', league2:'Major', league3:'Minor', league4:'Academy' };

function lookupTeam(slot, league) {
  const t = TEAM_DATA[slot];
  if (!t) return null;
  const idx = LEAGUE_KEYS.indexOf(league);
  if (idx < 0) return null;
  const lg = t.leagues[idx];
  if (!lg) return null;
  return {
    code: t.code,
    gm: t.gm,
    league,
    name: lg.name,
    org: lg.org,
    logo: lg.logo,
    fullName: (lg.org + ' ' + lg.name).trim(),
  };
}

module.exports = { TEAM_DATA, LEAGUE_KEYS, LEAGUE_LABELS, lookupTeam };
