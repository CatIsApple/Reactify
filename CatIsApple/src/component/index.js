import { normalizeChildren, mountTree } from '../vdom/index.js';
import { diff } from '../diff/index.js';
import { patch } from '../patch/index.js';
import { withDispatcher } from '../hooks/context.js';

function resolveComponents(value) {
  return normalizeChildren(value).flatMap((node) => {
    if (typeof node.type === 'function') {
      const resolved = withDispatcher(null, () => resolveComponents(
        node.type({ ...node.props, children: node.children }),
      ));
      if (node.key !== null && node.key !== undefined) {
        if (resolved.length !== 1) {
          throw new Error('A keyed child component must return exactly one root node.');
        }
        return [{ ...resolved[0], key: node.key }];
      }
      return resolved;
    }
    return { ...node, props: { ...node.props }, children: resolveComponents(node.children) };
  });
}

function throwCollected(errors) {
  if (errors.length === 1) throw errors[0];
  if (errors.length > 1) throw new AggregateError(errors, 'Multiple effect callbacks failed.');
}

export class FunctionComponent {
  constructor(component, container, { props = {}, onCommit, onError } = {}) {
    if (typeof component !== 'function') throw new TypeError('A root component must be a function.');
    if (!container || typeof container.replaceChildren !== 'function') {
      throw new TypeError('A root component needs a DOM container.');
    }
    this.component = component;
    this.container = container;
    this.props = props;
    this.onCommit = onCommit;
    this.onError = onError;
    this.hooks = [];
    this.cursor = 0;
    this.previousVNode = [];
    this.commitCount = 0;
    this.lastPatches = [];
    this.lastError = null;
    this.mounted = false;
    this._disposed = false;
    this._rendering = false;
    this._committing = false;
    this._pending = false;
    this._draftHooks = null;
  }

  mount() {
    if (this.mounted || this._disposed) {
      throw new Error('A FunctionComponent instance can only be mounted once.');
    }
    this._perform(this.props, true);
    return this;
  }

  update(nextProps = this.props) {
    if (!this.mounted || this._disposed) throw new Error('Cannot update an unmounted component.');
    this._perform(nextProps, false);
    return this;
  }

  _perform(nextProps, initial) {
    if (this._rendering || this._committing) throw new Error('Rendering cannot re-enter an update.');
    this._pending = false;
    this.cursor = 0;
    // Memo values and effect dependencies from a failed render must not become
    // the committed baseline. State setters always address the committed slots.
    this._draftHooks = this.hooks.map((slot) => ({ ...slot }));
    this._rendering = true;
    let tree;
    try {
      const output = withDispatcher(this, () => this.component(nextProps));
      if (!initial && this.cursor !== this.hooks.length) {
        throw new Error('Hook count changed between renders. Call Hooks in the same order.');
      }
      tree = withDispatcher(null, () => resolveComponents(output));
    } catch (error) {
      this.lastError = error;
      this._draftHooks = null;
      throw error;
    } finally {
      this._rendering = false;
    }

    this._committing = true;
    try {
      const patches = diff(initial ? [] : this.previousVNode, tree);
      if (initial) mountTree(this.container, tree);
      else patch(this.container, patches);

      this.props = nextProps;
      this.previousVNode = tree;
      this.hooks.splice(0, this.hooks.length, ...this._draftHooks);
      this._draftHooks = null;
      this.mounted = true;
      this.commitCount += 1;
      this.lastPatches = patches;
      this.lastError = null;

      const errors = [];
      try { this._flushEffects(); } catch (error) { errors.push(error); }
      try { this.onCommit?.({ patches, commitCount: this.commitCount, tree }); }
      catch (error) { errors.push(error); }
      throwCollected(errors);
    } catch (error) {
      this.lastError = error;
      this._draftHooks = null;
      throw error;
    } finally {
      this._committing = false;
    }
  }

  _claimHook(kind, initialize) {
    const index = this.cursor++;
    let slot = this._draftHooks[index];
    if (!slot) {
      if (this.mounted) throw new Error('Hook count changed between renders.');
      slot = { kind, ...initialize() };
      this._draftHooks[index] = slot;
    } else if (slot.kind !== kind) {
      throw new Error(`Hook order changed at slot ${index}: ${slot.kind} → ${kind}.`);
    }
    return [slot, index];
  }

  _setState(index, next) {
    if (this._rendering) throw new Error('State cannot be updated during rendering.');
    if (!this.mounted || this._disposed) return;
    const slot = this.hooks[index];
    if (!slot || slot.kind !== 'state') return;
    const value = typeof next === 'function' ? withDispatcher(null, () => next(slot.value)) : next;
    if (Object.is(slot.value, value)) return;
    slot.value = value;
    if (this._pending) return;
    this._pending = true;
    queueMicrotask(() => {
      if (!this._pending || !this.mounted || this._disposed) return;
      this._pending = false;
      try { this.update(); } catch (error) {
        this.lastError = error;
        if (this.onError) this.onError(error);
        else throw error;
      }
    });
  }

  _flushEffects() {
    const effects = this.hooks.filter((slot) => slot.kind === 'effect' && slot.changed);
    const errors = [];
    for (const slot of effects) {
      const cleanup = slot.cleanup;
      slot.cleanup = undefined;
      slot.changed = false;
      try { withDispatcher(null, () => cleanup?.()); } catch (error) { errors.push(error); }
    }
    for (const slot of effects) {
      if (!this.mounted) break;
      try {
        const cleanup = withDispatcher(null, slot.setup);
        if (cleanup !== undefined && typeof cleanup !== 'function') {
          throw new TypeError('An effect must return a cleanup function or undefined.');
        }
        // A setup may synchronously dispose its root. Its cleanup did not exist
        // when unmount visited this slot, so release it immediately in that case.
        if (this.mounted) slot.cleanup = cleanup;
        else withDispatcher(null, () => cleanup?.());
      } catch (error) { errors.push(error); }
    }
    throwCollected(errors);
  }

  unmount() {
    if (this._rendering) throw new Error('Cannot unmount during rendering.');
    if (this._disposed) return;
    this._disposed = true;
    this._pending = false;
    this.mounted = false;
    const errors = [];
    for (const slot of this.hooks) {
      if (slot.kind !== 'effect') continue;
      const cleanup = slot.cleanup;
      slot.cleanup = undefined;
      try { withDispatcher(null, () => cleanup?.()); } catch (error) { errors.push(error); }
    }
    try { patch(this.container, diff(this.previousVNode, [])); }
    catch (error) { errors.push(error); }
    this.previousVNode = [];
    throwCollected(errors);
  }
}
