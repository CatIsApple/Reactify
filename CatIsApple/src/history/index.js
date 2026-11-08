import { cloneTree, sameValue } from '../vdom/index.js';

/** Snapshots are private; callers receive independent copies on every read. */
export class History {
  #entries;
  #index = 0;

  constructor(initialTree = []) {
    this.#entries = [cloneTree(initialTree)];
  }

  get current() { return cloneTree(this.#entries[this.#index]); }
  get entries() { return this.#entries.map(cloneTree); }
  get index() { return this.#index; }
  get length() { return this.#entries.length; }
  get canUndo() { return this.#index > 0; }
  get canRedo() { return this.#index < this.#entries.length - 1; }

  commit(tree) {
    const next = cloneTree(tree);
    if (sameValue(this.#entries[this.#index], next)) return this.current;
    this.#entries = this.#entries.slice(0, this.#index + 1);
    this.#entries.push(next);
    this.#index += 1;
    return this.current;
  }

  undo() {
    if (this.canUndo) this.#index -= 1;
    return this.current;
  }

  redo() {
    if (this.canRedo) this.#index += 1;
    return this.current;
  }
}
