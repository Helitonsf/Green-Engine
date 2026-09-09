const CATALOG = [
  // Europa — masculino
  ["England", "Premier League", "male", "A"],
  ["England", "Championship", "male", "A"],
  ["Spain", "La Liga", "male", "A"],
  ["Spain", "Segunda División", "male", "B"],
  ["Italy", "Serie A", "male", "A"],
  ["Italy", "Serie B", "male", "B"],
  ["Germany", "Bundesliga", "male", "A"],
  ["Germany", "2. Bundesliga", "male", "B"],
  ["France", "Ligue 1", "male", "A"],
  ["France", "Ligue 2", "male", "B"],
  ["Portugal", "Primeira Liga", "male", "A"],
  ["Netherlands", "Eredivisie", "male", "A"],
  ["Belgium", "Jupiler Pro League", "male", "A"],
  ["Scotland", "Premiership", "male", "A"],
  ["Denmark", "Superliga", "male", "A"],
  ["Switzerland", "Super League", "male", "B"],
  ["Austria", "Bundesliga", "male", "B"],
  ["Turkey", "Süper Lig", "male", "A"],
  ["Poland", "Ekstraklasa", "male", "B"],
  ["Czech-Republic", "Czech Liga", "male", "B"],
  ["Norway", "Eliteserien", "male", "A"],
  ["Sweden", "Allsvenskan", "male", "A"],
  ["Greece", "Super League 1", "male", "B"],
  ["Romania", "Liga I", "male", "B"],
  ["Ukraine", "Premier League", "male", "B"],
  ["Croatia", "HNL", "male", "B"],
  ["Serbia", "Super Liga", "male", "B"],
  ["Ireland", "Premier Division", "male", "B"],
  ["Northern-Ireland", "Premiership", "male", "B"],
  // Americas — masculino
  ["Brazil", "Serie A", "male", "A"],
  ["Brazil", "Serie B", "male", "A"],
  ["Brazil", "Copa do Brasil", "male", "A"],
  ["Argentina", "Liga Profesional Argentina", "male", "A"],
  ["Argentina", "Primera Nacional", "male", "B"],
  ["Chile", "Primera División", "male", "A"],
  ["Colombia", "Primera A", "male", "A"],
  ["Ecuador", "Liga Pro", "male", "A"],
  ["Paraguay", "Division Profesional - Apertura", "male", "B"],
  ["Paraguay", "Division Profesional - Clausura", "male", "B"],
  ["Uruguay", "Primera División", "male", "B"],
  ["Peru", "Primera División", "male", "B"],
  ["Mexico", "Liga MX", "male", "A"],
  ["United-States", "Major League Soccer", "male", "A"],
  // Ásia/Oceania/África — masculino
  ["Japan", "J1 League", "male", "A"],
  ["South-Korea", "K League 1", "male", "A"],
  ["Australia", "A-League", "male", "A"],
  ["China", "Super League", "male", "B"],
  ["Saudi-Arabia", "Pro League", "male", "A"],
  ["United-Arab-Emirates", "Pro League", "male", "B"],
  ["South-Africa", "Premier Soccer League", "male", "B"],
  // Feminino — principais ligas
  ["England", "FA WSL", "female", "A"],
  ["England", "Women's Championship", "female", "B"],
  ["Spain", "Primera División Femenina", "female", "A"],
  ["France", "Feminine Division 1", "female", "A"],
  ["Germany", "Frauen-Bundesliga", "female", "A"],
  ["Italy", "Serie A Women", "female", "A"],
  ["Brazil", "Brasileirão Feminino", "female", "A"],
  ["United-States", "NWSL", "female", "A"],
  ["Mexico", "Liga MX Femenil", "female", "A"],
  ["Sweden", "Damallsvenskan", "female", "A"],
  ["Norway", "Toppserien", "female", "A"],
  ["Denmark", "Kvindeliga", "female", "A"],
  ["Netherlands", "Eredivisie Women", "female", "A"],
  ["Belgium", "Super League Women", "female", "B"],
  ["Switzerland", "AXA Women’s Super League", "female", "B"],
  ["Poland", "Ekstraliga Women", "female", "B"],
  ["Australia", "A-League Women", "female", "A"],
  ["South-Korea", "WK-League", "female", "B"],
  ["Scotland", "SWPL", "female", "A"],
  ["Ireland", "Women's Premier Division", "female", "B"],
  ["Russia", "Supreme Division Women", "female", "B"],
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
  ["Europe", "UEFA Nations League - Women", "female", "B"],
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
