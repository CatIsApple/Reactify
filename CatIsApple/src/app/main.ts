import { bindEditor } from './editor.js';
import { mountTasks } from './tasks.js';

/** 현재 열린 실습 페이지의 DOM에 편집기 또는 루트 컴포넌트를 연결한다. */
function startPage(): void {
  const tasks = document.getElementById('tasks');
  if (tasks) mountTasks(tasks);
  else bindEditor();
}

startPage();
