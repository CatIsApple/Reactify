import { FunctionComponent, h, useEffect, useMemo, useState } from '../core/index.ts';
import type { CommitMetrics, StateSetter, VNode } from '../core/index.ts';
import { mustQuery } from '../shared/dom.ts';
import { capturePatches, setupGameInspector } from './game-inspector.ts';

const faces = [
  { rank: 'A', symbol: '♠', name: 'A 스페이드', red: false },
  { rank: 'K', symbol: '♥', name: 'K 하트', red: true },
  { rank: 'Q', symbol: '♦', name: 'Q 다이아몬드', red: true },
  { rank: 'J', symbol: '♣', name: 'J 클로버', red: false },
  { rank: '10', symbol: '♥', name: '10 하트', red: true },
  { rank: '9', symbol: '♠', name: '9 스페이드', red: false },
  { rank: '8', symbol: '♦', name: '8 다이아몬드', red: true },
  { rank: '7', symbol: '♣', name: '7 클로버', red: false },
] as const;
const coverDelay = 1200;

type Face = (typeof faces)[number];
type Appearance = 'down' | 'open' | 'matched';
interface Move {
  kind: 'flip' | 'match' | 'mismatch' | 'cover' | 'restart';
  cards: readonly number[];
}
interface Game {
  deck: Face[];
  open: readonly number[];
  matched: readonly number[];
  move: Move | null;
}

function newGame(): Game {
  const deck = [...faces, ...faces];
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  return { deck, open: [], matched: [], move: null };
}

function appearance(game: Game, index: number): Appearance {
  if (game.matched.includes(index)) return 'matched';
  return game.open.includes(index) ? 'open' : 'down';
}

function canFlip(game: Game, index: number): boolean {
  return game.open.length < 2 && appearance(game, index) === 'down';
}

function flipCard(game: Game, index: number): Game {
  if (!canFlip(game, index)) return game;
  const cards = [...game.open, index];
  if (cards.length === 1) return { ...game, open: cards, move: { kind: 'flip', cards } };
  if (game.deck[cards[0]] === game.deck[index])
    return {
      ...game,
      open: [],
      matched: [...game.matched, ...cards],
      move: { kind: 'match', cards },
    };
  return { ...game, open: cards, move: { kind: 'mismatch', cards } };
}

interface CardProps {
  index: number;
  face: Face;
  appearance: Appearance;
  blocked: boolean;
  onFlip: () => void;
}

function Card({ index, face, appearance, blocked, onFlip }: CardProps): VNode {
  const isDown = appearance === 'down';
  const matched = appearance === 'matched';
  const description = isDown ? '뒤집기' : `${face.name} · ${matched ? '짝 맞춤' : '앞면'}`;
  const corner = (position: 'top' | 'bottom') =>
    h(
      'span',
      {
        'aria-hidden': 'true',
        className: `memory-corner memory-corner-${position}`,
        hidden: isDown,
        'data-suit': isDown ? null : face.symbol,
      },
      isDown ? '' : face.rank,
    );
  return h(
    'button',
    {
      type: 'button',
      className: `memory-card memory-card-${appearance}${!isDown && face.red ? ' memory-card-red' : ''}`,
      'aria-label': `${index + 1}번 카드, ${description}`,
      'aria-disabled': blocked ? 'true' : 'false',
      onClick: onFlip,
    },
    corner('top'),
    h('span', { 'aria-hidden': 'true', className: 'memory-symbol' }, isDown ? '' : face.symbol),
    corner('bottom'),
    h('span', { 'aria-hidden': 'true', className: 'memory-check', hidden: !matched }, '✓'),
  );
}

function positions(cards: readonly number[]): string {
  return `[${cards.map((index) => index + 1).join(', ')}]`;
}

export function setupMemoryGame() {
  const inspect = setupGameInspector();
  let rendered: { game: Game; attempts: number };
  let committed: typeof rendered | undefined;
  let committedTree: VNode | null = null;
  let pendingGame: Game | undefined;
  let scheduledCover: Game['open'] | undefined;

  function queueGame(setGame: StateSetter<Game>, game: Game): void {
    // Another click may arrive before this game state reaches the DOM.
    pendingGame = game;
    setGame(game);
  }

  function GameBoard(): VNode {
    const [game, setGame] = useState(newGame);
    const [attempts, setAttempts] = useState(0);
    const flip = useMemo(
      () =>
        Array.from({ length: faces.length * 2 }, (_, index) => () => {
          const current = pendingGame ?? committed?.game;
          if (!current) return;
          const next = flipCard(current, index);
          if (next === current) return;
          queueGame(setGame, next);
          if (current.open.length === 1) setAttempts((count) => count + 1);
        }),
      [setGame, setAttempts],
    );
    const restart = useMemo(
      () => () => {
        queueGame(setGame, { ...newGame(), move: { kind: 'restart', cards: [] } });
        setAttempts(0);
      },
      [setGame, setAttempts],
    );
    useEffect(() => {
      if (game.open.length !== 2) return;
      const open = game.open;
      const timer = setTimeout(() => {
        const current = pendingGame ?? committed?.game;
        if (current?.open === open)
          queueGame(setGame, { ...current, open: [], move: { kind: 'cover', cards: open } });
      }, coverDelay);
      scheduledCover = open;
      return () => {
        clearTimeout(timer);
        scheduledCover = undefined;
      };
    }, [game.open, setGame]);

    rendered = { game, attempts };
    const pairs = game.matched.length / 2;
    const hint =
      pairs === faces.length
        ? '모든 짝을 맞췄어요!'
        : game.open.length === 2
          ? '서로 다른 카드예요. 잠시 후 두 카드를 덮어요.'
          : game.open.length === 1
            ? '짝이 될 카드 한 장을 더 고르세요.'
            : '카드 두 장을 골라 같은 그림을 찾아보세요.';

    return h(
      'section',
      { className: 'panel memory-board', 'aria-labelledby': 'game-board-title' },
      h(
        'header',
        { className: 'memory-heading' },
        h('h1', { id: 'game-board-title' }, '카드 테이블'),
        h('p', { id: 'game-hint', className: 'memory-hint' }, hint),
      ),
      h(
        'div',
        { className: 'memory-table' },
        h(
          'div',
          { className: 'memory-grid', role: 'group', 'aria-label': '4×4 게임 보드' },
          ...game.deck.map((face, index) =>
            h(Card, {
              key: String(index),
              index,
              face,
              appearance: appearance(game, index),
              blocked: !canFlip(game, index),
              onFlip: flip[index],
            }),
          ),
        ),
      ),
      h(
        'footer',
        { className: 'memory-toolbar' },
        h(
          'div',
          { className: 'memory-chips', 'aria-hidden': 'true' },
          h('span'),
          h('span'),
          h('span'),
          h('span'),
        ),
        h('span', { id: 'game-attempts', className: 'memory-attempts' }, `시도 ${attempts}회`),
        h(
          'span',
          { id: 'game-pairs', className: 'memory-pairs' },
          `맞춘 짝 ${pairs} / ${faces.length}`,
        ),
        h('button', { type: 'button', className: 'primary-button', onClick: restart }, '다시 시작'),
      ),
    );
  }

  function record(metrics: CommitMetrics): void {
    const previous = committed;
    const previousTree = committedTree;
    const { game, attempts } = rendered;
    committed = rendered;
    committedTree = metrics.root.output;
    if (pendingGame === game) pendingGame = undefined;
    const move = game.move;
    if (!previous || !move || move === previous.game.move) return;

    const actions = {
      flip: `${move.cards[0] + 1}번 카드 뒤집기`,
      match: `${game.deck[move.cards[0]]?.name ?? ''} 짝 맞춤`,
      mismatch: '서로 다른 카드',
      cover: '두 카드 다시 덮기',
      restart: '새 게임',
    };
    let effect: string | undefined;
    if (move.kind === 'mismatch' && scheduledCover === game.open)
      effect = `DOM 반영 뒤 타이머 예약 (${coverDelay}ms)`;
    else if (move.kind === 'cover') effect = '예약된 타이머가 상태 변경을 요청함';
    else if (move.kind === 'restart' && previous.game.open.length === 2)
      effect = '이전 타이머 정리';

    inspect({
      number: metrics.commits,
      action: actions[move.kind],
      stateRequests: instance.hooks.reduce(
        (count, hook) => count + (hook.kind === 'state' ? hook.consumed : 0),
        0,
      ),
      state: [
        { field: 'open', before: positions(previous.game.open), after: positions(game.open) },
        {
          field: 'matched',
          before: positions(previous.game.matched),
          after: positions(game.matched),
        },
        { field: 'attempts', before: String(previous.attempts), after: String(attempts) },
      ],
      props: game.deck.flatMap((_, index) => {
        const before = appearance(previous.game, index);
        const after = appearance(game, index);
        return before === after ? [] : [{ field: `Card[${index + 1}].appearance`, before, after }];
      }),
      effect,
      patches: capturePatches(metrics.operations, previousTree, committedTree),
    });
  }

  const instance = new FunctionComponent(
    GameBoard,
    {},
    {
      onCommit: record,
      onError(error) {
        const box = mustQuery('#game-error');
        box.hidden = false;
        box.textContent = error.message;
      },
    },
  );
  return instance.mount(mustQuery('#game-app'));
}
