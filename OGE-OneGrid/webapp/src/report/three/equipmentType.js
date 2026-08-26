// Pure equipment-archetype classifier — deliberately kept free of `three` / r3f imports so
// that lightweight callers (e.g. the fleet grid / asset cards on the landing page) can map an
// asset to an archetype WITHOUT dragging the entire 3D engine into the initial bundle.
export function equipmentType(a) {
  const name = `${a?.name || ''}`.toLowerCase();
  const cat = `${a?.category || ''}`.toLowerCase();
  const test = (re) => re.test(name);
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
