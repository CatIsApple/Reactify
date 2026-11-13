import { setupLab } from './lab/lab.ts';
import { setupBoard } from './demo/board.ts';
import { setupMemoryGame } from './demo/memory-game.ts';
import { mustQuery } from './shared/dom.ts';

let lab: ReturnType<typeof setupLab> | undefined;
let board: ReturnType<typeof setupBoard> | undefined;
let game: ReturnType<typeof setupMemoryGame> | undefined;
const experiment = mustQuery('#page-experiment');
const experimentTitle = mustQuery('#experiment-title');
const htmlMode = mustQuery('#page-lab');
const stateMode = mustQuery('#page-hooks');
const gameMode = mustQuery('#page-game');
const inspectorToggle = mustQuery('#game-inspector-toggle');
const guide = mustQuery('#page-guide');
const guideLink = mustQuery('.guide-link');

function navigate(requestedPage: string): void {
  const showGuide = requestedPage === 'guide';
  const mode = requestedPage === 'lab' || requestedPage === 'hooks' ? requestedPage : 'game';
  experiment.hidden = showGuide;
  guide.hidden = !showGuide;
  htmlMode.hidden = showGuide || mode !== 'lab';
  stateMode.hidden = showGuide || mode !== 'hooks';
  gameMode.hidden = showGuide || mode !== 'game';
  inspectorToggle.hidden = gameMode.hidden;
  document.body.classList.toggle('game-theme', !gameMode.hidden);
  experimentTitle.hidden = !gameMode.hidden;
  if (showGuide) guideLink.setAttribute('aria-current', 'page');
  else guideLink.removeAttribute('aria-current');
  if (!htmlMode.hidden && !lab) lab = setupLab();
  if (!stateMode.hidden && !board) board = setupBoard();
  if (!gameMode.hidden && !game) game = setupMemoryGame();
}
window.addEventListener('hashchange', () => navigate(location.hash.slice(1)));
window.addEventListener('pagehide', (event) => {
  if (!event.persisted) {
    board?.unmount();
    game?.unmount();
  }
});
navigate(location.hash.slice(1));
