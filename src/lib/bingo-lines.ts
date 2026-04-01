/** Indices 0–24 pour une grille 5×5 (ligne par ligne). */
const ROWS: number[][] = [
  [0, 1, 2, 3, 4],
  [5, 6, 7, 8, 9],
  [10, 11, 12, 13, 14],
  [15, 16, 17, 18, 19],
  [20, 21, 22, 23, 24],
];

const COLS: number[][] = [
  [0, 5, 10, 15, 20],
  [1, 6, 11, 16, 21],
  [2, 7, 12, 17, 22],
  [3, 8, 13, 18, 23],
  [4, 9, 14, 19, 24],
];

const DIAGS: number[][] = [
  [0, 6, 12, 18, 24],
  [4, 8, 12, 16, 20],
];

const LINES = [...ROWS, ...COLS, ...DIAGS];

/**
 * Retourne les lignes (ligne, colonne, diagonale) complétées par ce joueur
 * pour les cellules présentes dans `tasksByCell` (tâches existantes).
 */
export function findNewBingoLines(
  doneCells: Set<number>,
  tasksByCell: Map<number, unknown>,
  alreadyCelebrated: Set<string>,
): string[] {
  const newLines: string[] = [];
  for (const line of LINES) {
    const key = line.join("-");
    if (alreadyCelebrated.has(key)) continue;
    const cellsInPlay = line.filter((c) => tasksByCell.has(c));
    if (cellsInPlay.length < 5) continue;
    const complete = cellsInPlay.every((c) => doneCells.has(c));
    if (complete) newLines.push(key);
  }
  return newLines;
}

export function hasAnyBingoLine(doneCells: Set<number>, tasksByCell: Map<number, unknown>): boolean {
  for (const line of LINES) {
    const cellsInPlay = line.filter((c) => tasksByCell.has(c));
    if (cellsInPlay.length < 5) continue;
    if (cellsInPlay.every((c) => doneCells.has(c))) return true;
  }
  return false;
}
