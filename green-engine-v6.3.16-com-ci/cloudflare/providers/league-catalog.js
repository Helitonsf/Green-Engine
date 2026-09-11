const CATALOG = [
  // Europa — masculino
  ["England", "Premier League", "male", "A"],
  ["Spain", "La Liga", "male", "A"],
  ["Italy", "Serie A", "male", "A"],
  ["Germany", "Bundesliga", "male", "A"],
  ["France", "Ligue 1", "male", "A"],
  ["Portugal", "Primeira Liga", "male", "A"],
  ["Netherlands", "Eredivisie", "male", "A"],
  ["Belgium", "Jupiler Pro League", "male", "A"],
  ["Scotland", "Premiership", "male", "A"],
  ["Denmark", "Superliga", "male", "A"],
  ["Turkey", "Süper Lig", "male", "A"],
  ["Norway", "Eliteserien", "male", "A"],
  ["Sweden", "Allsvenskan", "male", "A"],
  // Americas — masculino
  ["Brazil", "Serie A", "male", "A"],
  ["Brazil", "Serie B", "male", "A"],
  ["Brazil", "Copa do Brasil", "male", "A"],
  ["Argentina", "Liga Profesional Argentina", "male", "A"],
  ["Chile", "Primera División", "male", "A"],
  ["Colombia", "Primera A", "male", "A"],
  ["Ecuador", "Liga Pro", "male", "A"],
  ["Mexico", "Liga MX", "male", "A"],
  ["United-States", "Major League Soccer", "male", "A"],
  // Ásia/Oceania/África — masculino
  ["Japan", "J1 League", "male", "A"],
  ["South-Korea", "K League 1", "male", "A"],
  ["Australia", "A-League", "male", "A"],
  ["Saudi-Arabia", "Pro League", "male", "A"],
  // Feminino — principais ligas
  ["England", "FA WSL", "female", "A"],
  ["Spain", "Primera División Femenina", "female", "A"],
  ["France", "Feminine Division 1", "female", "A"],
  ["Germany", "Frauen-Bundesliga", "female", "A"],
  ["Italy", "Serie A Women", "female", "A"],
  ["Brazil", "Brasileirão Feminino", "female", "A"],
  ["United-States", "NWSL", "female", "A"],
  ["Mexico", "Liga MX Femenil", "female", "A"],
  ["Sweden", "Damallsvenskan", "female", "A"],
  ["Norway", "Toppserien", "female", "A"],
  // Internacionais — masculino/feminino
  ["World", "FIFA Club World Cup", "mixed", "A"],
  ["World", "World Cup", "mixed", "A"],
  ["World", "World Cup - Women", "female", "A"],
  ["World", "FIFA Women Champions Cup", "female", "A"],
  ["Europe", "UEFA Champions League", "male", "A"],
  ["Europe", "UEFA Europa League", "male", "A"],
  ["Europe", "UEFA Europa Conference League", "male", "B"],
  ["Europe", "UEFA Champions League Women", "female", "A"],
  ["Europe", "UEFA Championship - Women", "female", "A"],
  ["South-America", "CONMEBOL Sudamericana", "male", "A"],
  ["South-America", "CONMEBOL Libertadores", "male", "A"],
  ["South-America", "CONMEBOL Libertadores Femenina", "female", "A"]
];

function normalize(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

const ENTRIES = CATALOG.map(([country, name, gender, priority]) => ({
  country,
  name,
  gender,
  priority,
  key: `${normalize(country)}::${normalize(name)}`
}));

export function classifyLeague(league = {}) {
  const country = normalize(league.country || league.countryName);
  const name = normalize(league.name);
  const exact = ENTRIES.find(entry => entry.key === `${country}::${name}`);
  if (exact) return { ...exact, enabled: true };

  // A few API-Football country labels differ from the catalog labels.
  const fallback = ENTRIES.find(entry => normalize(entry.name) === name);
  if (fallback) return { ...fallback, enabled: true };

  return { enabled: false, country: league.country || league.countryName || null, name: league.name || null, gender: null, priority: null };
}

export function isAllowedLeague(league = {}) {
  return classifyLeague(league).enabled;
}

export function enrichLeague(league = {}) {
  const classification = classifyLeague(league);
  return { ...league, ...classification };
}

export function getLeagueCatalog() {
  return ENTRIES.map(entry => ({ ...entry, enabled: true }));
}
