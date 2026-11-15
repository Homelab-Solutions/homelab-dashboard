/* Reine Layout-Funktionen fuer die freie Anordnung (keine DOM-Zugriffe,
   Unit-testbar). Die gespeicherten Positionen (Prozentwerte) sind die alleinige
   Wahrheit und werden nie durch diese Datei veraendert: entweder passt das
   gespeicherte Layout komplett kollisionsfrei in den Container (dann wird es
   exakt so angezeigt), oder es wird fuer ALLE Kacheln auf das Raster
   umgeschaltet (siehe fitsFreeLayout). Eine Teilverschiebung einzelner
   Kacheln gibt es nicht mehr. */

export const FREE_LAYOUT_MIN_WIDTH = 1000;
export const TILE_GAP = 8;

/** Prueft, ob zwei Rechtecke (inkl. Mindestabstand) sich ueberschneiden. Wird
 *  sowohl von fitsFreeLayout als auch waehrend des Ziehens (home.js) gegen die
 *  gespeicherten bzw. aktuell angezeigten Positionen genutzt. */
export function rectsOverlap(a, b, gap = TILE_GAP) {
  return !(
    a.x + a.width + gap <= b.x ||
    b.x + b.width + gap <= a.x ||
    a.y + a.height + gap <= b.y ||
    b.y + b.height + gap <= a.y
  );
}

/**
 * Prueft rein geometrisch (keine Mutation der Eingaben), ob das gespeicherte
 * Freiform-Layout bei der aktuellen Containergroesse vollstaendig kollisionsfrei
 * und innerhalb der Grenzen darstellbar ist: keine zwei Kacheln ueberlappen
 * (inkl. Mindestabstand `minGap`) UND jede Kachel liegt vollstaendig innerhalb
 * von [0, containerWidth] x [0, containerHeight].
 *
 * @param {Array<{id: string|number, x: number, y: number}>} tiles Positionen in Pixeln.
 * @param {number} containerWidth Breite des Containers in Pixeln.
 * @param {number} containerHeight Verfuegbare Hoehe des Containers in Pixeln.
 * @param {Record<string|number, {width:number, height:number}>} tileSizes Gemessene Kachelmasse je id.
 * @param {number} [minGap] Mindestabstand zwischen Kacheln (Standard TILE_GAP).
 * @returns {boolean}
 */
export function fitsFreeLayout(tiles, containerWidth, containerHeight, tileSizes, minGap = TILE_GAP) {
  const width = Math.max(0, containerWidth);
  const height = Math.max(0, containerHeight);

  const rects = tiles.map((tile) => {
    const size = tileSizes[tile.id] || { width: 0, height: 0 };
    return {
      id: tile.id,
      x: tile.x,
      y: tile.y,
      width: Math.max(0, size.width),
      height: Math.max(0, size.height),
    };
  });

  for (const rect of rects) {
    if (rect.x < 0 || rect.y < 0) return false;
    if (rect.x + rect.width > width) return false;
    if (rect.y + rect.height > height) return false;
  }

  for (let i = 0; i < rects.length; i += 1) {
    for (let j = i + 1; j < rects.length; j += 1) {
      if (rectsOverlap(rects[i], rects[j], minGap)) return false;
    }
  }

  return true;
}
