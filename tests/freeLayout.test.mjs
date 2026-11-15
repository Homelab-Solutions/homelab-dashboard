import test from 'node:test';
import assert from 'node:assert/strict';
import { fitsFreeLayout, rectsOverlap } from '../public/js/freeLayout.js';

test('kollisionsfreies, passendes Layout -> true', () => {
  const tiles = [
    { id: 1, x: 0, y: 0 },
    { id: 2, x: 200, y: 0 },
    { id: 3, x: 0, y: 150 },
  ];
  const sizes = {
    1: { width: 150, height: 100 },
    2: { width: 150, height: 100 },
    3: { width: 150, height: 100 },
  };
  assert.equal(fitsFreeLayout(tiles, 1200, 800, sizes), true);
});

test('eine Ueberlappung -> false', () => {
  const tiles = [
    { id: 'a', x: 0, y: 0 },
    { id: 'b', x: 10, y: 10 },
  ];
  const sizes = {
    a: { width: 150, height: 100 },
    b: { width: 150, height: 100 },
  };
  assert.equal(fitsFreeLayout(tiles, 800, 800, sizes), false);
});

test('Kachel ragt ueber den rechten Rand hinaus -> false', () => {
  const tiles = [{ id: 1, x: 700, y: 0 }];
  const sizes = { 1: { width: 150, height: 100 } };
  assert.equal(fitsFreeLayout(tiles, 800, 800, sizes), false);
});

test('Kachel ragt ueber den unteren Rand hinaus -> false', () => {
  const tiles = [{ id: 1, x: 0, y: 750 }];
  const sizes = { 1: { width: 150, height: 100 } };
  assert.equal(fitsFreeLayout(tiles, 800, 800, sizes), false);
});

test('Kachel mit negativer Position (ausserhalb) -> false', () => {
  const tiles = [{ id: 1, x: -5, y: 0 }];
  const sizes = { 1: { width: 150, height: 100 } };
  assert.equal(fitsFreeLayout(tiles, 800, 800, sizes), false);
});

test('Randfall exakt minGap: Abstand genau am Mindestabstand gilt als kollisionsfrei', () => {
  const tiles = [
    { id: 1, x: 0, y: 0 },
    { id: 2, x: 158, y: 0 }, // 150 breit + 8px minGap = exakt angrenzend
  ];
  const sizes = {
    1: { width: 150, height: 100 },
    2: { width: 150, height: 100 },
  };
  assert.equal(fitsFreeLayout(tiles, 400, 400, sizes, 8), true);
});

test('Randfall knapp unter minGap: eine Kollision -> false', () => {
  const tiles = [
    { id: 1, x: 0, y: 0 },
    { id: 2, x: 157, y: 0 }, // 1px zu dicht am Mindestabstand
  ];
  const sizes = {
    1: { width: 150, height: 100 },
    2: { width: 150, height: 100 },
  };
  assert.equal(fitsFreeLayout(tiles, 400, 400, sizes, 8), false);
});

test('leere Kachelliste gilt als passend (true)', () => {
  assert.equal(fitsFreeLayout([], 800, 600, {}), true);
});

test('Eingaben werden nicht mutiert', () => {
  const tiles = [
    { id: 1, x: 0, y: 0 },
    { id: 2, x: 10, y: 10 },
  ];
  const sizes = {
    1: { width: 150, height: 100 },
    2: { width: 150, height: 100 },
  };
  const tilesCopy = JSON.parse(JSON.stringify(tiles));
  const sizesCopy = JSON.parse(JSON.stringify(sizes));
  fitsFreeLayout(tiles, 400, 400, sizes);
  assert.deepEqual(tiles, tilesCopy);
  assert.deepEqual(sizes, sizesCopy);
});

test('deterministisch: gleiche Eingabe liefert gleiches Ergebnis', () => {
  const tiles = [
    { id: 1, x: 50, y: 50 },
    { id: 2, x: 300, y: 55 },
  ];
  const sizes = {
    1: { width: 150, height: 100 },
    2: { width: 150, height: 100 },
  };
  const first = fitsFreeLayout(tiles, 1000, 800, sizes);
  const second = fitsFreeLayout(tiles, 1000, 800, sizes);
  assert.equal(first, second);
});

test('viele Kacheln: Laufzeit bleibt praktikabel', () => {
  const tiles = [];
  const sizes = {};
  for (let i = 0; i < 150; i += 1) {
    tiles.push({ id: i, x: (i % 10) * 160, y: Math.floor(i / 10) * 110 });
    sizes[i] = { width: 150, height: 100 };
  }
  const started = Date.now();
  const result = fitsFreeLayout(tiles, 1600, 2000, sizes);
  const elapsed = Date.now() - started;
  assert.ok(elapsed < 2000, 'fitsFreeLayout darf nicht haengen');
  assert.equal(result, true);
});

test('rectsOverlap: unveraendertes Verhalten fuer die Drag-Blockade', () => {
  const a = { x: 0, y: 0, width: 100, height: 100 };
  const b = { x: 108, y: 0, width: 100, height: 100 };
  assert.equal(rectsOverlap(a, b, 8), false);
  assert.equal(rectsOverlap(a, { ...b, x: 107 }, 8), true);
});
