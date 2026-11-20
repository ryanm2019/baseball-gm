// Fictional organizations and their affiliates.
import type { Affiliate, Level } from './types.ts';
import { shuffle } from './random.ts';

export interface OrgDef {
  region: string;
  name: string;
  abbrev: string;
  league: 'AL' | 'NL';
  div: 'East' | 'Central' | 'West';
  market: number; // 0.6 (small) .. 1.4 (huge); drives payroll levels
}

export const ORG_DEFS: OrgDef[] = [
  { region: 'New York', name: 'Knights', abbrev: 'NYK', league: 'AL', div: 'East', market: 1.4 },
  { region: 'Boston', name: 'Minutemen', abbrev: 'BOS', league: 'AL', div: 'East', market: 1.25 },
  { region: 'Baltimore', name: 'Clippers', abbrev: 'BAL', league: 'AL', div: 'East', market: 0.9 },
  { region: 'Toronto', name: 'Lynx', abbrev: 'TOR', league: 'AL', div: 'East', market: 1.1 },
  { region: 'Tampa Bay', name: 'Manatees', abbrev: 'TB', league: 'AL', div: 'East', market: 0.65 },
  { region: 'Chicago', name: 'Stockyards', abbrev: 'CHS', league: 'AL', div: 'Central', market: 1.0 },
  { region: 'Cleveland', name: 'Spiders', abbrev: 'CLE', league: 'AL', div: 'Central', market: 0.75 },
  { region: 'Detroit', name: 'Motors', abbrev: 'DET', league: 'AL', div: 'Central', market: 0.85 },
  { region: 'Kansas City', name: 'Scouts', abbrev: 'KC', league: 'AL', div: 'Central', market: 0.7 },
  { region: 'Minnesota', name: 'Loons', abbrev: 'MIN', league: 'AL', div: 'Central', market: 0.8 },
  { region: 'Houston', name: 'Comets', abbrev: 'HOU', league: 'AL', div: 'West', market: 1.1 },
  { region: 'Seattle', name: 'Sound', abbrev: 'SEA', league: 'AL', div: 'West', market: 0.95 },
  { region: 'Las Vegas', name: 'High Rollers', abbrev: 'LV', league: 'AL', div: 'West', market: 0.7 },
  { region: 'Texas', name: 'Wildcatters', abbrev: 'TEX', league: 'AL', div: 'West', market: 1.1 },
  { region: 'Orange County', name: 'Groves', abbrev: 'OC', league: 'AL', div: 'West', market: 1.05 },
  { region: 'Atlanta', name: 'Peaches', abbrev: 'ATL', league: 'NL', div: 'East', market: 1.1 },
  { region: 'Philadelphia', name: 'Liberty', abbrev: 'PHI', league: 'NL', div: 'East', market: 1.2 },
  { region: 'Brooklyn', name: 'Bridegrooms', abbrev: 'BKN', league: 'NL', div: 'East', market: 1.35 },
  { region: 'Miami', name: 'Flamingos', abbrev: 'MIA', league: 'NL', div: 'East', market: 0.6 },
  { region: 'Washington', name: 'Monuments', abbrev: 'WAS', league: 'NL', div: 'East', market: 0.85 },
  { region: 'Chicago', name: 'Whales', abbrev: 'CHW', league: 'NL', div: 'Central', market: 1.2 },
  { region: 'St. Louis', name: 'Arches', abbrev: 'STL', league: 'NL', div: 'Central', market: 0.95 },
  { region: 'Milwaukee', name: 'Hops', abbrev: 'MIL', league: 'NL', div: 'Central', market: 0.75 },
  { region: 'Cincinnati', name: 'Riverboats', abbrev: 'CIN', league: 'NL', div: 'Central', market: 0.75 },
  { region: 'Pittsburgh', name: 'Ironmen', abbrev: 'PIT', league: 'NL', div: 'Central', market: 0.65 },
  { region: 'Los Angeles', name: 'Stars', abbrev: 'LA', league: 'NL', div: 'West', market: 1.45 },
  { region: 'San Francisco', name: 'Fog', abbrev: 'SF', league: 'NL', div: 'West', market: 1.15 },
  { region: 'San Diego', name: 'Sailors', abbrev: 'SD', league: 'NL', div: 'West', market: 1.05 },
  { region: 'Arizona', name: 'Scorpions', abbrev: 'ARI', league: 'NL', div: 'West', market: 0.85 },
  { region: 'Colorado', name: 'Peaks', abbrev: 'COL', league: 'NL', div: 'West', market: 0.8 },
];

const MINOR_CITIES = [
  'Albuquerque', 'Akron', 'Altoona', 'Amarillo', 'Asheville', 'Augusta', 'Bakersfield', 'Beloit', 'Biloxi',
  'Binghamton', 'Birmingham', 'Bowling Green', 'Bradenton', 'Brevard', 'Buffalo', 'Burlington', 'Cedar Rapids',
  'Charleston', 'Charlotte', 'Chattanooga', 'Clearwater', 'Columbia', 'Columbus', 'Corpus Christi', 'Dayton',
  'Daytona', 'Des Moines', 'Dunedin', 'Durham', 'El Paso', 'Erie', 'Eugene', 'Everett', 'Fayetteville',
  'Fort Wayne', 'Fresno', 'Frisco', 'Great Falls', 'Greensboro', 'Greenville', 'Gwinnett', 'Harrisburg',
  'Hartford', 'Hickory', 'Hillsboro', 'Huntsville', 'Indianapolis', 'Inland Empire', 'Iowa', 'Jacksonville',
  'Jupiter', 'Kannapolis', 'Lake County', 'Lakeland', 'Lansing', 'Las Cruces', 'Lehigh Valley', 'Lexington',
  'Little Rock', 'Louisville', 'Lynchburg', 'Madison', 'Memphis', 'Midland', 'Mobile', 'Modesto', 'Montgomery',
  'Myrtle Beach', 'Nashville', 'New Hampshire', 'Norfolk', 'Oklahoma City', 'Omaha', 'Pensacola', 'Peoria',
  'Portland', 'Quad Cities', 'Rancho Cucamonga', 'Reading', 'Reno', 'Richmond', 'Rochester', 'Rome', 'Round Rock',
  'Sacramento', 'Salem', 'Salt Lake', 'San Antonio', 'San Jose', 'Savannah', 'Scranton', 'Somerset', 'South Bend',
  'Spokane', 'Springfield', 'Stockton', 'Sugar Land', 'Syracuse', 'Tacoma', 'Tampa', 'Toledo', 'Trenton', 'Tri-City',
  'Tulsa', 'Vancouver', 'Visalia', 'Wichita', 'Wilmington', 'Winston-Salem', 'Wisconsin', 'Worcester', 'Yakima',
  'Boise', 'Billings', 'Missoula', 'Ogden', 'Pueblo', 'Tucson', 'Laredo', 'Shreveport', 'Macon', 'Mobile Bay',
  'Kinston', 'Frederick', 'Hagerstown', 'Lowell', 'Pawtucket',
];

const MINOR_MASCOTS = [
  'Isotopes', 'RubberDucks', 'Curve', 'Sod Poodles', 'Tourists', 'GreenJackets', 'Blaze', 'Sky Carp', 'Shuckers',
  'Rumble Ponies', 'Barons', 'Hot Rods', 'Marauders', 'Bisons', 'Bees', 'Kernels', 'RiverDogs', 'Knights',
  'Lookouts', 'Threshers', 'Fireflies', 'Clippers', 'Hooks', 'Dragons', 'Tortugas', 'Cubs', 'Blue Jays', 'Bulls',
  'Chihuahuas', 'SeaWolves', 'Emeralds', 'AquaSox', 'Woodpeckers', 'TinCaps', 'Grizzlies', 'RoughRiders', 'Voyagers',
  'Grasshoppers', 'Drive', 'Stripers', 'Senators', 'Yard Goats', 'Crawdads', 'Hops', 'Trash Pandas', 'Indians',
  '66ers', 'Jumbo Shrimp', 'Hammerheads', 'Cannon Ballers', 'Captains', 'Flying Tigers', 'Lugnuts', 'Vaqueros',
  'IronPigs', 'Legends', 'Travelers', 'Bats', 'Hillcats', 'Mallards', 'Redbirds', 'RockHounds', 'BayBears',
  'Nuts', 'Biscuits', 'Pelicans', 'Sounds', 'Fisher Cats', 'Tides', 'Dodgers', 'Storm Chasers', 'Blue Wahoos',
  'Chiefs', 'Sea Dogs', 'River Bandits', 'Quakes', 'Fightin Phils', 'Aces', 'Flying Squirrels', 'Red Wings',
  'Emperors', 'Express', 'River Cats', 'Red Sox', 'Bees II', 'Missions', 'Giants', 'Bananas', 'RailRiders',
  'Patriots', 'Cubs II', 'Indians II', 'Cardinals', 'Ports', 'Space Cowboys', 'Mets', 'Rainiers', 'Tarpons',
  'Mud Hens', 'Thunder', 'Dust Devils', 'Drillers', 'Canadians', 'Rawhide', 'Wind Surge', 'Blue Rocks', 'Dash',
  'Timber Rattlers', 'Red Sox II', 'Pippins', 'Hawks', 'Mustangs', 'PaddleHeads', 'Raptors', 'Rockies', 'Aviators',
  'Tecolotes', 'Mudcats', 'Bandits', 'Owls', 'Keys', 'Suns', 'Spinners', 'Paw Sox',
];

function cleanMascot(m: string): string {
  return m.replace(/ II$/, '');
}

// Each org gets AAA, AA, A+, A affiliates with invented city/mascot pairs,
// plus complex-league and DSL clubs named after the parent club.
export function buildAffiliates(defs: OrgDef[]): Record<Level, Affiliate>[] {
  const cities = shuffle([...MINOR_CITIES]);
  const mascots = shuffle([...MINOR_MASCOTS]);
  let ci = 0;
  let mi = 0;
  return defs.map((d) => {
    const make = (): Affiliate => {
      const city = cities[ci++ % cities.length];
      const mascot = cleanMascot(mascots[mi++ % mascots.length]);
      return { name: `${city} ${mascot}`, abbrev: city.slice(0, 3).toUpperCase() };
    };
    const cpxLeague = d.league === 'AL' ? 'FCL' : 'ACL';
    return {
      MLB: { name: `${d.region} ${d.name}`, abbrev: d.abbrev },
      AAA: make(),
      AA: make(),
      'A+': make(),
      A: make(),
      CPX: { name: `${cpxLeague} ${d.name}`, abbrev: d.abbrev },
      DSL: { name: `DSL ${d.name}`, abbrev: d.abbrev },
    };
  });
}
