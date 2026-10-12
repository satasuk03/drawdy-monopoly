// Turn marker: a glowing ring in the current player's color, drawn around
// their token. 100x100 viewBox; the ring stays inside 8 units of the edge so
// the glow isn't clipped.

export function turnRingSvg(color: string): string {
    return (
        `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" width="100" height="100">` +
        `<defs><filter id="g" x="-30%" y="-30%" width="160%" height="160%"><feGaussianBlur stdDeviation="3.5"/></filter></defs>` +
        `<circle cx="50" cy="50" r="40" fill="none" stroke="${color}" stroke-width="9" opacity=".75" filter="url(#g)"/>` +
        `<circle cx="50" cy="50" r="40" fill="none" stroke="#fff" stroke-width="7"/>` +
        `<circle cx="50" cy="50" r="40" fill="none" stroke="${color}" stroke-width="4"/>` +
        `</svg>`
    );
}
