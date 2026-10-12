// Icon library: IconKey -> SVG fragment drawn in a 24x24 box using
// currentColor, so callers tint it with `color` on the wrapper / <use>.

const S = `fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"`;
const F = `fill="currentColor"`;
const T = `fill="currentColor" fill-opacity=".28"`;

const ICONS: Record<string, string> = {
    "go-arrow": `<path d="M3 12h15M12 5l7 7-7 7" ${S}/>`,
    "jail-bars": `<rect x="4" y="4" width="16" height="16" rx="2.5" ${S}/><path d="M9 4v16M12 4v16M15 4v16" ${S}/>`,
    parking: `<rect x="3.5" y="3.5" width="17" height="17" rx="3" ${T} stroke="currentColor" stroke-width="1.8"/><path d="M9.5 17V7h3.5a3 3 0 010 6H9.5" ${S}/>`,
    police: `<path d="M12 3l8 3v6c0 5-4 8-8 9-4-1-8-4-8-9V6z" ${T} stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/><path d="M12 8l1.2 2.6 2.8.3-2.1 1.9.6 2.8-2.5-1.4-2.5 1.4.6-2.8L8 10.9l2.8-.3z" ${F}/>`,
    chance: `<circle cx="12" cy="12" r="9.5" ${T} stroke="currentColor" stroke-width="1.8"/><path d="M9 9.5a3 3 0 116 0c0 2-3 2.2-3 4" ${S}/><circle cx="12" cy="17.3" r="1.1" ${F}/>`,
    chest: `<path d="M3 11h18v9H3zM3 11V8a2 2 0 012-2h14a2 2 0 012 2v3" ${S}/><rect x="10" y="10" width="4" height="5" rx="1" ${F}/>`,
    tax: `<path d="M6 3h9l4 4v14H6z" ${T} stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/><path d="M9 16l6-6" ${S}/><circle cx="9.5" cy="10.5" r="1.2" ${F}/><circle cx="14.5" cy="15.5" r="1.2" ${F}/>`,
    diamond: `<path d="M12 2.5l9.5 9.5-9.5 9.5L2.5 12z" ${T} stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/>`,
    train: `<path d="M2 17V9.5h11V5h6.5a2.5 2.5 0 012.5 2.5V17z" ${S}/><rect x="15" y="7.5" width="4" height="4" rx=".8" ${S} stroke-width="1.5"/><path d="M5 9.5V6h3.5v3.5M4 13.5h5" ${S} stroke-width="1.5"/><circle cx="6.5" cy="18.5" r="2" fill="currentColor"/><circle cx="12" cy="18.5" r="2" fill="currentColor"/><circle cx="17.5" cy="18.5" r="2" fill="currentColor"/><path d="M1.5 22h21" ${S} stroke-width="1.5"/>`,
    bus: `<rect x="2.5" y="4.5" width="19" height="13" rx="3" ${S}/><path d="M2.5 11.5h19M9 4.5v7M15.5 4.5v7" ${S} stroke-width="1.5"/><circle cx="7" cy="18" r="2.200" fill="currentColor"/><circle cx="17" cy="18" r="2.200" fill="currentColor"/><path d="M20 14.5h1.5" ${S}/>`,
    metro: `<circle cx="12" cy="12" r="9.5" ${S}/><path d="M7.5 16.5v-9l4.5 5.5 4.5-5.5v9" ${S}/>`,
    plane: `<path d="M21.5 2.5L10.5 13.5M21.5 2.5l-6.5 19-4.5-8-8-4.5z" ${S}/>`,
    rocket: `<path d="M12 2c3 2 5 5 5 9l-2 3.5H9L7 11c0-4 2-7 5-9z" ${T} stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/><circle cx="12" cy="9" r="1.7" ${F}/><path d="M7 12.5L4 17l4-1M17 12.5l3 4.5-4-1M10 17.5c0 2 1 3.5 2 4.5 1-1 2-2.5 2-4.5" ${S}/>`,
    portal: `<ellipse cx="12" cy="12" rx="6.5" ry="9.5" ${S}/><ellipse cx="12" cy="12" rx="3" ry="5.8" ${T} stroke="currentColor" stroke-width="1.6"/>`,
    griffin: `<path d="M3 19c1-8 7-14 18-14-2 3-3.5 4.5-6 5.5 2 .2 3.2-.2 4.5-1.2-1 4.5-5 8.5-9.5 8.5.8-.8 1-1.7 1-2.8-3 2-5 3-8 4z" ${T} stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/>`,
    bulb: `<path d="M9 18h6M10 21h4M12 3a6 6 0 00-4 10.5c.8.8 1 1.5 1 2.5h6c0-1 .2-1.7 1-2.5A6 6 0 0012 3z" ${S}/>`,
    water: `<path d="M12 3c4 5 6 8 6 11a6 6 0 01-12 0c0-3 2-6 6-11z" ${T} stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/>`,
    reactor: `<g ${S} stroke-width="1.5"><ellipse cx="12" cy="12" rx="10" ry="4"/><ellipse cx="12" cy="12" rx="10" ry="4" transform="rotate(60 12 12)"/><ellipse cx="12" cy="12" rx="10" ry="4" transform="rotate(120 12 12)"/></g><circle cx="12" cy="12" r="1.8" ${F}/>`,
    ice: `<path d="M12 2v20M3.3 7l17.4 10M3.3 17L20.7 7M9.5 3.8L12 6l2.5-2.2M9.5 20.2L12 18l2.5 2.2" ${S} stroke-width="1.6"/>`,
    mana: `<path d="M12 2c1 6 4 9 10 10-6 1-9 4-10 10-1-6-4-9-10-10 6-1 9-4 10-10z" ${T} stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/>`,
    forge: `<path d="M3 7h13c0 3-3 4.5-5 4.5V15h4v3.5H7V15h3v-3.5C7 11.5 4 10 3 7zM16 7h5c0 2.5-2.5 3.5-4.5 3.5" ${T} stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/>`,
    house: `<path d="M3 11.5L12 3.5l9 8M5.5 10v10.5h13V10M10 20.5v-6h4v6" ${S}/>`,
    building: `<rect x="5" y="3" width="14" height="18" rx="1" ${S}/><path d="M9 7h2M13 7h2M9 11h2M13 11h2M9 15h2M13 15h2M10.5 21v-3h3v3" ${S} stroke-width="1.5"/>`,
    temple: `<path d="M12 2.5l2.5 3.5h-5zM6 11l1.5-3.5h9L18 11zM4 16l2-3.5h12l2 3.5zM3 21.5l1-5.5h16l1 5.5z" ${T} stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/>`,
    tower: `<path d="M7 21.5V10L5.5 8.5V3h3.5v2h2V3h2v2h2V3h3.5v5.5L17 10v11.5zM10.5 21.5v-4a1.5 1.5 0 013 0v4" ${S} stroke-width="1.6"/>`,
    palm: `<path d="M12 22c0-5 .8-8.5 2-12" ${S}/><path d="M14 10c-3-4-7-4.5-10-2.5 4-1 6 0 8 3zM14 10c1-4 4-6 8-5-4 0-6 2-7 5zM14 10c3 0 6 2 7 6-2-3-4-4-7-4zM14 10c-2 2-3.5 4-3.5 6" ${T} stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/>`,
    mountain: `<path d="M2 20l7.5-13.5 4 7 2.5-3.5L22 20z" ${T} stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/><path d="M7.5 10.5l2 1.5 2-1.5" ${S} stroke-width="1.3"/>`,
    castle: `<path d="M3 21V8h3v2h2.5V8h2v2h3V8h2v2H18V8h3v13zM10 21v-5a2 2 0 014 0v5" ${S} stroke-width="1.6"/>`,
    planet: `<circle cx="12" cy="12" r="6" ${T} stroke="currentColor" stroke-width="1.7"/><ellipse cx="12" cy="12" rx="10.5" ry="3.5" transform="rotate(-22 12 12)" ${S} stroke-width="1.5"/>`,
    moon: `<path d="M20 14.5A9 9 0 119.5 4a7 7 0 0010.5 10.5z" ${T} stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/>`,
    star: `<path d="M12 2.5l2.9 6.3 6.8.7-5.1 4.6 1.5 6.8L12 17.4 5.9 20.9l1.5-6.8L2.3 9.5l6.8-.7z" ${T} stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/>`,
    tree: `<path d="M12 2.5l6 8.5h-3l4 6.5H5L9 11H6zM12 17.5v4" ${T} stroke="currentColor" stroke-width="1.7" stroke-linejoin="round" stroke-linecap="round"/>`,
    shop: `<path d="M3 9.5L5 4h14l2 5.5c0 2-3 2-3 0 0 2-3 2-3 0 0 2-3 2-3 0 0 2-3 2-3 0 0 2-3 2-3 0zM5 12v8.5h14V12M10 20.5v-5h4v5" ${S} stroke-width="1.6"/>`,
    boat: `<path d="M3 15h18l-3 5H6zM12 3v12M12 4.5L18 14h-6M12 7.5L7 14h5" ${S} stroke-width="1.6"/>`,
    crown: `<path d="M3 18L2 7l6 5 4-8 4 8 6-5-1 11zM4.5 21.5h15" ${T} stroke="currentColor" stroke-width="1.7" stroke-linejoin="round" stroke-linecap="round"/>`,
    coin: `<circle cx="12" cy="12" r="9.5" ${T} stroke="currentColor" stroke-width="1.8"/><path d="M14.8 9.3c-.5-1-1.5-1.5-2.8-1.5-1.6 0-2.7.8-2.7 2s1 1.6 2.7 2 2.7.8 2.7 2-1.1 2-2.7 2c-1.3 0-2.4-.5-2.9-1.6M12 5.8v2M12 16.2v2" ${S} stroke-width="1.5"/>`,
    gem: `<path d="M6 3.5h12l4 5.5-10 12L2 9zM2 9h20M9 3.5L7.5 9 12 21M15 3.5L16.5 9 12 21" ${S} stroke-width="1.5"/>`,
    flame: `<path d="M12 2c1 4 6 6.5 6 12a6 6 0 01-12 0c0-3 2-4.5 2-7.5 2 1 3 2 3 4 1-2.5 1-5 1-8.5z" ${T} stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/>`,
};

export const ICON_KEYS = Object.keys(ICONS);

/** Resolve a (possibly unknown) key to a known one. */
export function iconKey(key: string | undefined, fallback = "diamond"): string {
    return key && ICONS[key] ? key : fallback;
}

/** Inner SVG for a 24x24 box; paints with currentColor. */
export function iconBody(key: string | undefined): string {
    return `<g stroke-width="1.8">${ICONS[iconKey(key)]}</g>`;
}

/** Standalone icon placed at (x,y) with size and color. */
export function iconAt(key: string | undefined, x: number, y: number, size: number, color: string): string {
    return `<g transform="translate(${x} ${y}) scale(${Math.round((size / 24) * 1000) / 1000})" color="${color}">${iconBody(key)}</g>`;
}
