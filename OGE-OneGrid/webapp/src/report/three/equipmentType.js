// Pure equipment-archetype classifier — deliberately kept free of `three` / r3f imports so
// that lightweight callers (e.g. the fleet grid / asset cards on the landing page) can map an
// asset to an archetype WITHOUT dragging the entire 3D engine into the initial bundle.
export function equipmentType(a) {
  // Known equipment types (O&G + embedded electric equipment) win outright when present.
  const t = `${a?.type || ''}`.toLowerCase();
  const OAG = ['well', 'offshore_platform', 'refinery', 'lng_terminal', 'storage', 'port', 'pipeline',
    'turbine', 'boiler', 'pump', 'generator'];
  if (OAG.includes(t)) return t;
  const name = `${a?.name || ''}`.toLowerCase();
  const cat = `${a?.category || ''}`.toLowerCase();
  const test = (re) => re.test(name);
  // Oil & Gas by name/category.
  if (test(/platform|fpso|spar|rig/)) return 'offshore_platform';
  if (test(/well|xmas|christmas tree|esp/)) return 'well';
  if (test(/refinery|crude|distill/)) return 'refinery';
  if (test(/lng|regas|liquefaction/)) return 'lng_terminal';
  if (test(/tank|storage|terminal farm/)) return 'storage';
  if (test(/pipeline|pipe\b|trunk\s*line/)) return 'pipeline';
  if (test(/port|dock|quay|jetty/)) return 'port';
  // Power-generation archetypes.
  if (test(/boiler|furnace|drum|economizer|superheat/)) return 'boiler';
  if (test(/turbine/)) return 'turbine';
  if (test(/pump|bfp|feed\s*pump/)) return 'pump';
  if (test(/gen(erator)?|alternator|exciter/)) return 'generator';
  // fall back to category / group only if the name was inconclusive
  const s = `${cat} ${a?.group || ''}`.toLowerCase();
  if (/boiler/.test(s)) return 'boiler';
  if (/pump/.test(s)) return 'pump';
  if (/turbine/.test(s)) return 'turbine';
  return 'skid';
}
