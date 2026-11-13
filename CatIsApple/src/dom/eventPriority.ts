import { getCurrentPriorityLevel } from '../scheduler/index.js';

/** DOM 이벤트를 처리할 때 부여하는 갱신 우선순위다. */
export type EventPriority = 'sync' | 'user-blocking' | 'normal' | 'idle';

const discreteEvents = new Set([
  'afterblur', 'auxclick', 'beforeblur', 'beforeinput', 'beforetoggle', 'blur', 'cancel', 'change',
  'click', 'close', 'compositionend', 'compositionstart', 'compositionupdate', 'contextmenu', 'copy',
  'cut', 'dblclick', 'dragend', 'dragstart', 'drop', 'focus', 'focusin', 'focusout', 'fullscreenchange',
  'fullscreenerror', 'hashchange', 'input', 'invalid', 'keydown', 'keypress', 'keyup', 'mousedown', 'mouseup',
  'paste', 'pause', 'play', 'pointercancel', 'pointerdown', 'pointerup', 'popstate', 'ratechange', 'reset',
  'seeked', 'select', 'selectionchange', 'selectstart', 'submit', 'textInput', 'toggle', 'touchcancel',
  'touchend', 'touchstart', 'volumechange',
]);

const continuousEvents = new Set([
  'drag', 'dragenter', 'dragexit', 'dragleave', 'dragover', 'mouseenter', 'mouseleave', 'mousemove',
  'mouseout', 'mouseover', 'pointerenter', 'pointerleave', 'pointermove', 'pointerout', 'pointerover',
  'resize', 'scroll', 'touchmove', 'wheel',
]);

/** 이벤트 이름으로 갱신 우선순위를 구한다. message로 실행한 호스트 콜백은 스케줄러의 우선순위를 따른다. */
export function getEventPriority(type: string): EventPriority {
  if (discreteEvents.has(type)) return 'sync';
  if (continuousEvents.has(type)) return 'user-blocking';
  if (type === 'message') {
    switch (getCurrentPriorityLevel()) {
      case 'immediate': return 'sync';
      case 'user-blocking': return 'user-blocking';
      case 'idle': return 'idle';
    }
  }
  return 'normal';
}
