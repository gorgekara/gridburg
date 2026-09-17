/** Inline stroke icons, 24x24. Kept as inner SVG markup so they inherit the button's text color. */
const I: Record<string, string> = {
  money: '<circle cx="12" cy="12" r="9"/><path d="M15 8.5c-.6-1-1.7-1.5-3-1.5-1.8 0-3 1-3 2.4 0 3.2 6 1.6 6 4.8 0 1.5-1.3 2.4-3 2.4-1.4 0-2.6-.6-3.2-1.7M12 5.5v13"/>',
  caret: '<path d="m6 9 6 6 6-6"/>',
  people: '<circle cx="9" cy="8" r="3.2"/><path d="M3 20c0-3.5 2.7-6 6-6s6 2.5 6 6"/><circle cx="17.5" cy="9" r="2.4"/><path d="M16 14.3c3 .1 5 2.3 5 5.2"/>',
  jobs: '<rect x="3" y="7.5" width="18" height="12" rx="2"/><path d="M9 7.5V5.5a1.5 1.5 0 0 1 1.5-1.5h3A1.5 1.5 0 0 1 15 5.5v2M3 13h18"/>',
  car: '<path d="M4 16v-3.5l2-5A2 2 0 0 1 7.9 6h8.2a2 2 0 0 1 1.9 1.5l2 5V16"/><path d="M3 16h18v2.5H3z"/><circle cx="7.5" cy="13.5" r="1"/><circle cx="16.5" cy="13.5" r="1"/>',
  smog: '<path d="M7 14a4 4 0 0 1 .6-7.95A5 5 0 0 1 17.3 7.5 3.3 3.3 0 0 1 17 14z"/><path d="M5 17.5h10M9 21h10"/>',
  link: '<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.700l-1 1"/><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/>',
  help: '<circle cx="12" cy="12" r="9"/><path d="M9.5 9.5a2.5 2.5 0 1 1 3.6 2.2c-.8.4-1.1 1-1.1 1.800M12 17v.2"/>',
  menu: '<path d="M4 7h16M4 12h16M4 17h16"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  city: '<path d="M3 21V9l6-3v15M9 21V3l8 4v14M17 21v-9l4 2v7M2 21h20"/>',
  sewage: '<path d="M3 7h9a4 4 0 0 1 4 4v2"/><path d="M3 12h8"/><path d="M16 16s2.2 2.4 2.2 3.8a2.2 2.2 0 0 1-4.4 0c0-1.4 2.2-3.8 2.2-3.8z"/>',
  roads: '<path d="M8 21 10 3M16 21 14 3"/><path d="M12 5v2M12 11v2M12 17v2"/>',
  traffic: '<rect x="8" y="2" width="8" height="20" rx="3"/><circle cx="12" cy="7" r="1.5"/><circle cx="12" cy="12" r="1.5"/><circle cx="12" cy="17" r="1.5"/>',
  zones: '<rect x="3" y="3" width="8" height="8" rx="1"/><rect x="13" y="3" width="8" height="8" rx="1"/><rect x="3" y="13" width="8" height="8" rx="1"/><rect x="13" y="13" width="8" height="8" rx="1"/>',
  power: '<path d="M13 2 5 14h6l-1 8 8-12h-6z"/>',
  water: '<path d="M12 3s6 6.5 6 11a6 6 0 0 1-12 0c0-4.5 6-11 6-11z"/>',
  bulldoze: '<path d="M3 17h13v-5H9V8H5v9M16 14l5 3v2h-5"/><circle cx="6.5" cy="19.5" r="1.5"/><circle cx="12.5" cy="19.5" r="1.5"/>',
  road: '<path d="M8 21 10 3M16 21 14 3"/><path d="M12 5v2M12 11v2M12 17v2"/>',
  avenue: '<path d="M4 21 7 3M20 21 17 3"/><path d="M11.2 4v16M12.8 4v16"/>',
  upgrade: '<path d="M12 18V6M6.5 11.5 12 6l5.5 5.5"/><path d="M5 21h14"/>',
  straight: '<path d="M5 19 19 5"/><circle cx="5" cy="19" r="1.6"/><circle cx="19" cy="5" r="1.6"/>',
  curve: '<path d="M5 19C5 10 10 5 19 5"/><circle cx="5" cy="19" r="1.6"/><circle cx="19" cy="5" r="1.6"/><circle cx="6" cy="6" r="1.2"/>',
  smooth: '<path d="M3 17c3-9 6-9 9-5s6 4 9-5"/>',
  roundabout: '<circle cx="12" cy="12" r="5.5"/><path d="M12 2v4.5M12 17.5V22M2 12h4.5M17.5 12H22"/>',
  light: '<rect x="8" y="2" width="8" height="20" rx="3"/><circle cx="12" cy="7" r="1.5"/><circle cx="12" cy="12" r="1.5"/><circle cx="12" cy="17" r="1.5"/>',
  oneway: '<path d="M4 12h15M13 6l6 6-6 6"/>',
  res: '<path d="M3 11 12 4l9 7"/><path d="M5 10v10h14V10"/><path d="M10 20v-5h4v5"/>',
  com: '<path d="M4 9 5 4h14l1 5"/><path d="M4 9a2.7 2.7 0 0 0 5.3 0 2.7 2.7 0 0 0 5.4 0A2.7 2.7 0 0 0 20 9"/><path d="M5 12v8h14v-8"/>',
  ind: '<path d="M3 21V10l6 4v-4l6 4V4h4v17z"/>',
  wind: '<path d="M12 22V11"/><circle cx="12" cy="9.5" r="1.3"/><path d="M12 8.2V2M13.1 10.2l5.4 3M10.9 10.2l-5.4 3"/>',
  coal: '<path d="M3 21V12l5 3v-3l5 3V7h3v14z"/><path d="M14.5 4.5c.5-2 3-2 3.5-.5 1.5-.5 2.5 1 1.5 2"/>',
  tower: '<rect x="6" y="3" width="12" height="8" rx="2"/><path d="M8 11 6 21M16 11l2 10M12 11v10M7 16h10"/>',
  pump: '<path d="M12 21s5-5 5-9a5 5 0 0 0-10 0c0 4 5 9 5 9z"/><path d="M12 14V8.5M9.7 10.8 12 8.5l2.3 2.3"/>',
  outlet: '<path d="M3 7h9a4 4 0 0 1 4 4v2"/><path d="M3 12h8"/><path d="M16 16s2.2 2.4 2.2 3.8a2.2 2.2 0 0 1-4.4 0c0-1.4 2.2-3.8 2.2-3.8z"/>',
  puzzle: '<path d="M10 4.5A1.8 1.8 0 0 1 13.6 4.5H17a1 1 0 0 1 1 1v3a1.8 1.8 0 0 0 0 3.6V16a1 1 0 0 1-1 1h-3.4a1.8 1.8 0 0 0-3.6 0H6.5a1 1 0 0 1-1-1v-3.4a1.8 1.8 0 0 1 0-3.6V5.5a1 1 0 0 1 1-1z"/>',
  star: '<path d="m12 3.6 2.6 5.3 5.8.85-4.2 4.1 1 5.75L12 16.9l-5.2 2.7 1-5.75-4.2-4.1 5.8-.85z"/>',
  check: '<path d="m4.5 12.5 5 5 10-11"/>',
  dot: '<circle cx="12" cy="12" r="4.5"/>',
};

export function icon(name: string, size = 22): SVGSVGElement {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('width', String(size));
  svg.setAttribute('height', String(size));
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '1.7');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  svg.innerHTML = I[name] ?? '';
  return svg;
}
