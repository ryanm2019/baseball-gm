// Name pools for random players, weighted by birth country.

const US_FIRST = [
  'Aaron', 'Adam', 'Alex', 'Andrew', 'Austin', 'Ben', 'Blake', 'Bobby', 'Brady', 'Brandon', 'Brent', 'Brett',
  'Bryce', 'Caleb', 'Carson', 'Casey', 'Chase', 'Chris', 'Cody', 'Cole', 'Colin', 'Connor', 'Corey', 'Dalton',
  'Dane', 'Daniel', 'David', 'Derek', 'Drew', 'Dylan', 'Eli', 'Eric', 'Ethan', 'Evan', 'Garrett', 'Gavin',
  'Grant', 'Gunnar', 'Hunter', 'Ian', 'Jace', 'Jack', 'Jackson', 'Jake', 'James', 'Jared', 'Jason', 'Jay',
  'Jeff', 'Jordan', 'Josh', 'Justin', 'Kyle', 'Landon', 'Logan', 'Luke', 'Mark', 'Mason', 'Matt', 'Max',
  'Michael', 'Mike', 'Nate', 'Nick', 'Noah', 'Owen', 'Parker', 'Patrick', 'Paul', 'Preston', 'Reid', 'Riley',
  'Ryan', 'Sam', 'Sawyer', 'Scott', 'Sean', 'Seth', 'Shane', 'Spencer', 'Steven', 'Tanner', 'Tate', 'Taylor',
  'Travis', 'Trent', 'Trevor', 'Tristan', 'Ty', 'Tyler', 'Wade', 'Walker', 'Wes', 'Will', 'Wyatt', 'Zach',
  'Marcus', 'Darius', 'Terrell', 'Jalen', 'Andre', 'Malik', 'Isaiah', 'Xavier', 'Cam', 'Devin', 'Trey', 'Jaylen',
];

const US_LAST = [
  'Adams', 'Allen', 'Anderson', 'Bailey', 'Baker', 'Barnes', 'Bell', 'Bennett', 'Brooks', 'Brown', 'Bryant',
  'Butler', 'Campbell', 'Carter', 'Clark', 'Cole', 'Collins', 'Cook', 'Cooper', 'Cox', 'Crawford', 'Davis',
  'Dixon', 'Duncan', 'Edwards', 'Ellis', 'Evans', 'Fisher', 'Foster', 'Fox', 'Gibson', 'Graham', 'Grant',
  'Gray', 'Green', 'Griffin', 'Hall', 'Hamilton', 'Harper', 'Harris', 'Hayes', 'Henderson', 'Hill', 'Holland',
  'Howard', 'Hughes', 'Hunt', 'Jackson', 'James', 'Jenkins', 'Johnson', 'Jones', 'Kelly', 'Kennedy', 'King',
  'Knight', 'Lane', 'Lawson', 'Lee', 'Lewis', 'Long', 'Marshall', 'Martin', 'Mason', 'Matthews', 'McCoy',
  'McDonald', 'Miller', 'Mills', 'Mitchell', 'Moore', 'Morgan', 'Morris', 'Murphy', 'Murray', 'Nelson',
  'Nichols', 'Owens', 'Palmer', 'Parker', 'Patterson', 'Payne', 'Perry', 'Peterson', 'Phillips', 'Porter',
  'Powell', 'Price', 'Reed', 'Reynolds', 'Rice', 'Roberts', 'Robinson', 'Rogers', 'Ross', 'Russell', 'Sanders',
  'Scott', 'Shaw', 'Simmons', 'Smith', 'Snyder', 'Spencer', 'Stewart', 'Stone', 'Sullivan', 'Taylor', 'Thomas',
  'Thompson', 'Tucker', 'Turner', 'Walker', 'Wallace', 'Ward', 'Warren', 'Watson', 'Webb', 'Wells', 'West',
  'White', 'Williams', 'Wilson', 'Wood', 'Wright', 'Young', 'Hoffman', 'Schmidt', 'Becker', 'Kowalski', 'Novak',
  'Brennan', 'Doyle', 'Gallagher', 'Keane', 'Lindqvist', 'Olsen', 'Pruitt', 'Quinn', 'Sorensen', 'Vance',
];

const LATIN_FIRST = [
  'Adrián', 'Alejandro', 'Alexander', 'Andrés', 'Ángel', 'Anthony', 'Carlos', 'César', 'Cristian', 'Daniel',
  'Dariel', 'Diego', 'Eduardo', 'Elvis', 'Emmanuel', 'Enrique', 'Erick', 'Eugenio', 'Fernando', 'Francisco',
  'Franklin', 'Gabriel', 'Geraldo', 'Gilberto', 'Gregory', 'Héctor', 'Hendry', 'Isaac', 'Jairo', 'Javier',
  'Jefferson', 'Jesús', 'Jhonny', 'Joel', 'Jonathan', 'Jorge', 'José', 'Juan', 'Julio', 'Junior', 'Kelvin',
  'Leonel', 'Luis', 'Manuel', 'Marcos', 'Miguel', 'Moisés', 'Nelson', 'Omar', 'Oneil', 'Orlando', 'Óscar',
  'Pablo', 'Pedro', 'Rafael', 'Ramón', 'Randy', 'Raúl', 'Ricardo', 'Roberto', 'Rodolfo', 'Ronald', 'Samuel',
  'Santiago', 'Sergio', 'Starling', 'Teoscar', 'Victor', 'Wander', 'Wilmer', 'Wilson', 'Yainer', 'Yeison',
  'Yordan', 'Yoendrys', 'Yunior', 'Edwin', 'Freddy', 'Gleyber', 'Jeremy', 'Keibert', 'Marcell', 'Willy',
];

const LATIN_LAST = [
  'Abreu', 'Acosta', 'Almonte', 'Álvarez', 'Arias', 'Báez', 'Batista', 'Bautista', 'Beltré', 'Benítez',
  'Cabrera', 'Calderón', 'Castillo', 'Castro', 'Cedeño', 'Cruz', 'De la Cruz', 'De León', 'Delgado', 'Díaz',
  'Domínguez', 'Encarnación', 'Espinal', 'Estrada', 'Féliz', 'Fernández', 'Figueroa', 'Flores', 'Franco',
  'García', 'Gómez', 'González', 'Guerrero', 'Gutiérrez', 'Hernández', 'Herrera', 'Jiménez', 'Lara', 'López',
  'Marte', 'Martínez', 'Medina', 'Mejía', 'Méndez', 'Mercedes', 'Mojica', 'Montero', 'Morales', 'Moreno',
  'Núñez', 'Ortega', 'Ortiz', 'Pérez', 'Peña', 'Polanco', 'Ramírez', 'Ramos', 'Reyes', 'Rivera', 'Rodríguez',
  'Rojas', 'Rosario', 'Ruiz', 'Sánchez', 'Santana', 'Santos', 'Severino', 'Soto', 'Suárez', 'Tavárez',
  'Tejada', 'Torres', 'Urías', 'Valdez', 'Vargas', 'Vásquez', 'Velázquez', 'Ventura', 'Vizcaíno', 'Zapata',
];

const ASIAN_FIRST = ['Shota', 'Yuki', 'Kenta', 'Haruto', 'Daiki', 'Ji-ho', 'Min-jun', 'Hyun', 'Wei', 'Chen', 'Ryo', 'Kazuki'];

export interface Country {
  name: string;
  first: string[];
  last: string[];
}

const COUNTRIES: Record<string, Country> = {
  USA: { name: 'USA', first: US_FIRST, last: US_LAST },
  DOM: { name: 'Dominican Republic', first: LATIN_FIRST, last: LATIN_LAST },
  VEN: { name: 'Venezuela', first: LATIN_FIRST, last: LATIN_LAST },
  CUB: { name: 'Cuba', first: LATIN_FIRST, last: LATIN_LAST },
  PUR: { name: 'Puerto Rico', first: LATIN_FIRST, last: LATIN_LAST },
  MEX: { name: 'Mexico', first: LATIN_FIRST, last: LATIN_LAST },
  COL: { name: 'Colombia', first: LATIN_FIRST, last: LATIN_LAST },
  PAN: { name: 'Panama', first: LATIN_FIRST, last: LATIN_LAST },
  CAN: { name: 'Canada', first: US_FIRST, last: US_LAST },
  JPN: { name: 'Japan', first: ASIAN_FIRST.slice(0, 6).concat(['Ryo', 'Kazuki']), last: ['Tanaka', 'Suzuki', 'Sato', 'Yamamoto', 'Ito', 'Mori'] },
  KOR: { name: 'South Korea', first: ['Ji-ho', 'Min-jun', 'Hyun', 'Seung', 'Jae'], last: ['Kim', 'Lee', 'Park', 'Choi', 'Jung'] },
  TWN: { name: 'Taiwan', first: ['Wei', 'Chen', 'Yu', 'Hao'], last: ['Lin', 'Chang', 'Wang', 'Huang'] },
};

// Where domestic (draft-route) players vs international signees come from.
const DOMESTIC_MIX: [string, number][] = [['USA', 88], ['CAN', 4], ['PUR', 6], ['MEX', 2]];
const INTL_MIX: [string, number][] = [
  ['DOM', 50], ['VEN', 30], ['CUB', 5], ['COL', 5], ['PAN', 4], ['MEX', 3], ['JPN', 1], ['KOR', 1], ['TWN', 1],
];

function pickWeighted(mix: [string, number][]): string {
  const total = mix.reduce((s, [, w]) => s + w, 0);
  let r = Math.random() * total;
  for (const [c, w] of mix) {
    r -= w;
    if (r <= 0) return c;
  }
  return mix[0][0];
}

export function randomOrigin(international: boolean): { country: string; first: string; last: string } {
  const code = pickWeighted(international ? INTL_MIX : DOMESTIC_MIX);
  const c = COUNTRIES[code];
  const first = c.first[Math.floor(Math.random() * c.first.length)];
  const last = c.last[Math.floor(Math.random() * c.last.length)];
  return { country: c.name, first, last };
}

export function randomStaffName(): { first: string; last: string } {
  const intl = Math.random() < 0.2;
  const { first, last } = randomOrigin(intl);
  return { first, last };
}
